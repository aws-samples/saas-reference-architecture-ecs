#!/bin/bash -e

# Install dependencies
sudo yum update -y
sudo yum install -y nodejs
sudo yum install -y jq
sudo yum install -y python3-pip
sudo yum install -y npm
sudo npm install -g aws-cdk
sudo python3 -m pip install --upgrade setuptools

# Enable nocasematch option
shopt -s nocasematch

export REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]' 2>&1)
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Download from the ecs reference solution Bucket
export CDK_PARAM_S3_BUCKET_NAME="saas-reference-architecture-ecs-$ACCOUNT_ID-$REGION"
export CDK_SOURCE_NAME="source.zip"

VERSIONS=$(aws s3api list-object-versions --bucket "$CDK_PARAM_S3_BUCKET_NAME" --prefix "$CDK_SOURCE_NAME" --query 'Versions[?IsLatest==`true`].{VersionId:VersionId}' --output text 2>&1)
CDK_PARAM_COMMIT_ID=$(echo "$VERSIONS" | awk 'NR==1{print $1}')

aws s3api get-object --bucket "$CDK_PARAM_S3_BUCKET_NAME" --key "$CDK_SOURCE_NAME" --version-id "$CDK_PARAM_COMMIT_ID" "$CDK_SOURCE_NAME" 2>&1 
unzip $CDK_SOURCE_NAME
cd ./server

sed "s/<REGION>/$REGION/g; s/<ACCOUNT_ID>/$ACCOUNT_ID/g" ./service-info.txt > ./lib/service-info.json

npm install

# Parse tenant details from the input message from step function
export CDK_PARAM_TENANT_ID=$tenantId
export TIER=$tier
export TENANT_ADMIN_EMAIL=$email

# Define variables
TENANT_ADMIN_USERNAME="tenant-admin-$CDK_PARAM_TENANT_ID"
STACK_NAME="tenant-template-stack-basic"
USER_POOL_OUTPUT_PARAM_NAME="TenantUserpoolId"
API_GATEWAY_URL_OUTPUT_PARAM_NAME="ApiGatewayUrl"
APP_CLIENT_ID_OUTPUT_PARAM_NAME="UserPoolClientId"
BOOTSTRAP_STACK_NAME="shared-infra-stack"


# Deploy the tenant template for premium && advanced tier(silo)
if [[ $TIER == "PREMIUM" || $TIER == "ADVANCED" ]]; then
  STACK_NAME="tenant-template-stack-$CDK_PARAM_TENANT_ID"
  if [[ $TIER == "ADVANCED" ]]; then
    export CDK_ADV_CLUSTER=$(aws ecs describe-clusters --cluster prod-advanced-${ACCOUNT_ID} | jq -r '.clusters[0].status')
  fi

  export CDK_PARAM_CONTROL_PLANE_SOURCE='sbt-control-plane-api'
  export CDK_PARAM_ONBOARDING_DETAIL_TYPE='Onboarding'
  export CDK_PARAM_PROVISIONING_DETAIL_TYPE=$CDK_PARAM_ONBOARDING_DETAIL_TYPE
  export CDK_PARAM_OFFBOARDING_DETAIL_TYPE='Offboarding'
  export CDK_PARAM_DEPROVISIONING_DETAIL_TYPE=$CDK_PARAM_OFFBOARDING_DETAIL_TYPE
  export CDK_PARAM_PROVISIONING_EVENT_SOURCE="sbt-application-plane-api"
  export CDK_PARAM_APPLICATION_NAME_PLANE_SOURCE="sbt-application-plane-api"
  export CDK_PARAM_TIER=$TIER
  cdk deploy $STACK_NAME --exclusively --require-approval never 
fi

# Read tenant details from the cloudformation stack output parameters
SAAS_APP_USERPOOL_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='$USER_POOL_OUTPUT_PARAM_NAME'].OutputValue" --output text)
SAAS_APP_CLIENT_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='$APP_CLIENT_ID_OUTPUT_PARAM_NAME'].OutputValue" --output text)
API_GATEWAY_URL=$(aws cloudformation describe-stacks --stack-name $BOOTSTRAP_STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='$API_GATEWAY_URL_OUTPUT_PARAM_NAME'].OutputValue" --output text)

# Create tenant admin user 
aws cognito-idp admin-create-user \
  --user-pool-id "$SAAS_APP_USERPOOL_ID" \
  --username "$TENANT_ADMIN_USERNAME" \
  --user-attributes Name=email,Value="$TENANT_ADMIN_EMAIL" Name=email_verified,Value="True" Name=phone_number,Value="+11234567890" Name="custom:userRole",Value="TenantAdmin" Name="custom:tenantId",Value="$CDK_PARAM_TENANT_ID" Name="custom:tenantTier",Value="$TIER" \
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
export tenantStatus="Complete"
