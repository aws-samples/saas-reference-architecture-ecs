#!/bin/bash -e

export CDK_PARAM_SYSTEM_ADMIN_EMAIL="$1"

if [[ -z "$CDK_PARAM_SYSTEM_ADMIN_EMAIL" ]]; then
  echo "Please provide system admin email"
  exit 1
fi

# Generate API keys if not provided
if [[ -z "$CDK_PARAM_API_KEY_PREMIUM_TIER_PARAMETER" ]]; then
  export CDK_PARAM_API_KEY_PREMIUM_TIER_PARAMETER="$(uuidgen | tr '[:upper:]' '[:lower:]')-sbt"
  echo "Generated Premium API Key: $CDK_PARAM_API_KEY_PREMIUM_TIER_PARAMETER"
fi

if [[ -z "$CDK_PARAM_API_KEY_ADVANCED_TIER_PARAMETER" ]]; then
  export CDK_PARAM_API_KEY_ADVANCED_TIER_PARAMETER="$(uuidgen | tr '[:upper:]' '[:lower:]')-sbt"
  echo "Generated Advanced API Key: $CDK_PARAM_API_KEY_ADVANCED_TIER_PARAMETER"
fi

if [[ -z "$CDK_PARAM_API_KEY_BASIC_TIER_PARAMETER" ]]; then
  export CDK_PARAM_API_KEY_BASIC_TIER_PARAMETER="$(uuidgen | tr '[:upper:]' '[:lower:]')-sbt"
  echo "Generated Basic API Key: $CDK_PARAM_API_KEY_BASIC_TIER_PARAMETER"
fi

export REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')  # Region setting
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Create S3 Bucket for provision source.
source ./utils/update-provision-source.sh

echo "CDK_PARAM_COMMIT_ID exists: $CDK_PARAM_COMMIT_ID"

# Create ECS service linked role.
ECS_ROLE=$(aws iam list-roles --query 'Roles[?contains(RoleName, `AWSServiceRoleForECS`)].Arn' --output text)
if [ -z "$ECS_ROLE" ]; then
    aws iam create-service-linked-role --aws-service-name ecs.amazonaws.com | cat
else
    echo "ECS Service linked role exists: $ECS_ROLE"
fi
# Create RDS service linked role.
RDS_ROLE=$(aws iam list-roles --query 'Roles[?contains(RoleName, `AWSServiceRoleForRDS`)].Arn' --output text)
if [ -z "$RDS_ROLE" ]; then
    aws iam create-service-linked-role --aws-service-name rds.amazonaws.com | cat
else
    echo "RDS Service linked role exists: $RDS_ROLE"
fi
# Preprovision basic infrastructure
cd ../server

FILE="/tmp/db_type.env"

if [ -f "$FILE" ]; then
    source /tmp/db_type.env
    echo "DB_TYPE: $DB_TYPE"
else
    DB_TYPE="dynamodb"
fi

if [ "$DB_TYPE" == 'mysql' ]; then 
    sed "s/<REGION>/$REGION/g; s/<ACCOUNT_ID>/$ACCOUNT_ID/g" ./service-info_mysql.txt > ./lib/service-info.json
else
    sed "s/<REGION>/$REGION/g; s/<ACCOUNT_ID>/$ACCOUNT_ID/g" ./service-info.txt > ./lib/service-info.json
fi

# npx cdk bootstrap
export CDK_PARAM_ONBOARDING_DETAIL_TYPE='Onboarding'
export CDK_PARAM_PROVISIONING_DETAIL_TYPE=$CDK_PARAM_ONBOARDING_DETAIL_TYPE
export CDK_PARAM_OFFBOARDING_DETAIL_TYPE='Offboarding'
export CDK_PARAM_DEPROVISIONING_DETAIL_TYPE=$CDK_PARAM_OFFBOARDING_DETAIL_TYPE
export CDK_PARAM_TIER='basic'
export CDK_PARAM_STAGE='prod'
export CDK_ADV_CLUSTER='INACTIV'
export CDK_BASIC_CLUSTER="$CDK_PARAM_STAGE-$CDK_PARAM_TIER"
export CDK_USE_DB=$DB_TYPE

npm install
npx cdk bootstrap

SERVICES=$(aws ecs list-services --cluster $CDK_BASIC_CLUSTER --query 'serviceArns[*]' --output text || true)
for SERVICE in $SERVICES; do
    SERVICE_NAME=$(echo $SERVICE | rev | cut -d '/' -f 1 | rev)
    echo -n "==== Service Connect re-set if any...  "
    aws ecs update-service \
        --cluster $CDK_BASIC_CLUSTER \
        --service $SERVICE_NAME \
        --service-connect-configuration 'enabled=false' \
        --no-cli-pager --query 'service.serviceArn' --output text
done

# Detect OS type and skip ARM64 setup on Mac
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Detected macOS - skipping ARM64 emulation setup"
else
    # Make the script executable
    chmod +x ../scripts/setup_multiarch.sh

    # Run the setup_multiarch.sh script
    echo "Running setup_multiarch.sh to configure ARM64 emulation..."
    ../scripts/setup_multiarch.sh

    # Create a symlink in /usr/local/bin for global access
    sudo ln -sf ../scripts/setup_multiarch.sh /usr/local/bin/setup_multiarch

    echo "ARM64 emulation setup complete!"
    echo "You can run 'setup_multiarch' command anytime to refresh the configuration"
fi
# End Multi Architecture Setting

npx cdk deploy --all --require-approval=never --concurrency 10 --asset-parallelism true

# Get SaaS application url
ADMIN_SITE_URL=$(aws cloudformation describe-stacks --stack-name shared-infra-stack --query "Stacks[0].Outputs[?OutputKey=='adminSiteUrl'].OutputValue" --output text)
APP_SITE_URL=$(aws cloudformation describe-stacks --stack-name shared-infra-stack --query "Stacks[0].Outputs[?OutputKey=='appSiteUrl'].OutputValue" --output text)
echo "Admin site url: $ADMIN_SITE_URL"
echo "Application site url: $APP_SITE_URL"