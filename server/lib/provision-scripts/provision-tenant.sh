#!/bin/bash -e

# Install only necessary dependencies (most tools already in STANDARD_7_0)
echo "Using pre-installed tools from CodeBuild STANDARD_7_0 image"
node --version
npm --version
aws --version

# Only install CDK (not pre-installed)
sudo npm install -g aws-cdk

# Upgrade setuptools if needed
python3 -m pip install --upgrade setuptools --user

# Enable nocasematch option
shopt -s nocasematch

export REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]' 2>&1)
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Download from the ecs reference solution Bucket
export CDK_PARAM_S3_BUCKET_NAME="saas-reference-architecture-ecs-$ACCOUNT_ID-$REGION"
export CDK_SOURCE_NAME="source.tar.gz"

VERSIONS=$(aws s3api list-object-versions --bucket "$CDK_PARAM_S3_BUCKET_NAME" --prefix "$CDK_SOURCE_NAME" --query 'Versions[?IsLatest==`true`].{VersionId:VersionId}' --output text 2>&1)
CDK_PARAM_COMMIT_ID=$(echo "$VERSIONS" | awk 'NR==1{print $1}')

aws s3api get-object --bucket "$CDK_PARAM_S3_BUCKET_NAME" --key "$CDK_SOURCE_NAME" --version-id "$CDK_PARAM_COMMIT_ID" "$CDK_SOURCE_NAME" 2>&1 
tar --warning=no-unknown-keyword -xzf $CDK_SOURCE_NAME 2>/dev/null || tar -xzf $CDK_SOURCE_NAME
cd ./server

# Use DynamoDB only
sed "s/<REGION>/$REGION/g; s/<ACCOUNT_ID>/$ACCOUNT_ID/g" ./service-info.txt > ./lib/service-info.json

cat ./lib/service-info.json

npm install

# Parse tenant details from the input message from step function
export CDK_PARAM_TENANT_ID=$tenantId
export TIER=$tier
export TENANT_ADMIN_EMAIL=$email
export TENANT_NAME=$tenantName
export USE_FEDERATION=$useFederation

# Dynamic configuration processing (Premium only)
if [[ $TIER == "PREMIUM" ]]; then
    export CDK_PARAM_USE_EC2_PREMIUM="${useEc2:-true}"  # Premium: dynamic from onboarding
fi
# Advanced and Basic use fixed settings from .env file
export CDK_PARAM_USE_RPROXY="${useRProxy:-true}"

# Define variables
# TENANT_ADMIN_USERNAME="tenant-admin-$CDK_PARAM_TENANT_ID"
TENANT_ADMIN_USERNAME="$TENANT_ADMIN_EMAIL"
STACK_NAME="tenant-template-stack-basic"
USER_POOL_OUTPUT_PARAM_NAME="TenantUserpoolId"
API_GATEWAY_URL_OUTPUT_PARAM_NAME="ApiGatewayUrl"
APP_CLIENT_ID_OUTPUT_PARAM_NAME="UserPoolClientId"
BOOTSTRAP_STACK_NAME="shared-infra-stack"


# Deploy the tenant template for premium && advanced tier(silo)
if [[ $TIER == "PREMIUM" || $TIER == "ADVANCED" ]]; then
    STACK_NAME="tenant-template-stack-$CDK_PARAM_TENANT_ID"
    if [[ $TIER == "PREMIUM" ]]; then
      export CDK_ADV_CLUSTER='INACTIVE'
    else
      export CDK_ADV_CLUSTER='ACTIVE'
    fi

    export CDK_PARAM_CONTROL_PLANE_SOURCE='sbt-control-plane-api'
    export CDK_PARAM_ONBOARDING_DETAIL_TYPE='Onboarding'
    export CDK_PARAM_PROVISIONING_DETAIL_TYPE=$CDK_PARAM_ONBOARDING_DETAIL_TYPE
    export CDK_PARAM_OFFBOARDING_DETAIL_TYPE='Offboarding'
    export CDK_PARAM_DEPROVISIONING_DETAIL_TYPE=$CDK_PARAM_OFFBOARDING_DETAIL_TYPE
    export CDK_PARAM_PROVISIONING_EVENT_SOURCE="sbt-application-plane-api"
    export CDK_PARAM_APPLICATION_NAME_PLANE_SOURCE="sbt-application-plane-api"
    export CDK_PARAM_TIER=$TIER
    export CDK_PARAM_TENANT_NAME=$TENANT_NAME  #Added for demonstration during the workshop
    export CDK_PARAM_USE_FEDERATION=$USE_FEDERATION ###Federation check for selfSign

    
    # Optimization flags for faster deployment
    export SKIP_AUTOSCALING=true
    export CDK_DISABLE_VERSION_CHECK=true

    # cdk deploy $STACK_NAME --exclusively --require-approval never --concurrency 10 --asset-parallelism true

    # Added to buildspec.yml
    export CDK_ASSET_PARALLELISM=true
    export CDK_DISABLE_STACK_TRACE=true

    cdk deploy $STACK_NAME \
      --exclusively \
      --require-approval never \
      --concurrency 10 \
      --asset-parallelism true \
      --no-rollback

fi

# Read tenant details from the cloudformation stack output parameters
SAAS_APP_USERPOOL_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='$USER_POOL_OUTPUT_PARAM_NAME'].OutputValue" --output text)
SAAS_APP_CLIENT_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='$APP_CLIENT_ID_OUTPUT_PARAM_NAME'].OutputValue" --output text)
API_GATEWAY_URL=$(aws cloudformation describe-stacks --stack-name $BOOTSTRAP_STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='$API_GATEWAY_URL_OUTPUT_PARAM_NAME'].OutputValue" --output text)

# Create tenant admin user 
aws cognito-idp admin-create-user \
  --user-pool-id "$SAAS_APP_USERPOOL_ID" \
  --username "$TENANT_ADMIN_USERNAME" \
  --user-attributes Name=email,Value="$TENANT_ADMIN_EMAIL" Name=email_verified,Value="True" Name=phone_number,Value="+11234567890" Name="custom:userRole",Value="TenantAdmin" Name="custom:tenantId",Value="$CDK_PARAM_TENANT_ID" Name="custom:tenantTier",Value="$TIER" Name="custom:tenantName",Value="$TENANT_NAME"\
  --desired-delivery-mediums EMAIL

# Create tenant user group
aws cognito-idp create-group \
  --user-pool-id "$SAAS_APP_USERPOOL_ID" \
  --group-name "$CDK_PARAM_TENANT_ID"

# Add tenant admin user to tenant user group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$SAAS_APP_USERPOOL_ID" \
  --username "$TENANT_ADMIN_USERNAME" \
  --group-name "$CDK_PARAM_TENANT_ID"

# Create JSON response of output parameters
export tenantConfig=$(jq --arg SAAS_APP_USERPOOL_ID "$SAAS_APP_USERPOOL_ID" \
--arg SAAS_APP_CLIENT_ID "$SAAS_APP_CLIENT_ID" \
--arg API_GATEWAY_URL "$API_GATEWAY_URL" \
-n '{"userPoolId":$SAAS_APP_USERPOOL_ID,"appClientId":$SAAS_APP_CLIENT_ID,"apiGatewayUrl":$API_GATEWAY_URL}')
export registrationStatus="Created"
