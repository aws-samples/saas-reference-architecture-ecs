#!/bin/bash -e

export CDK_PARAM_SYSTEM_ADMIN_EMAIL="dummy"

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

# Preprovision basic infrastructure
cd ../server

# Copy .env.example to .env only if .env doesn't exist
if [ ! -f ".env" ]; then
    if [ ! -f ".env.example" ]; then
        echo "Error: .env.example file not found"
        exit 1
    fi
    cp .env.example .env
    echo "Created .env file from .env.example"
else
    echo "Using existing .env file"
fi

# Use DynamoDB only
sed "s/<REGION>/$REGION/g; s/<ACCOUNT_ID>/$ACCOUNT_ID/g" ./service-info.txt > ./lib/service-info.json

# npx cdk bootstrap
export CDK_PARAM_ONBOARDING_DETAIL_TYPE='Onboarding'
export CDK_PARAM_PROVISIONING_DETAIL_TYPE=$CDK_PARAM_ONBOARDING_DETAIL_TYPE
export CDK_PARAM_OFFBOARDING_DETAIL_TYPE='Offboarding'
export CDK_PARAM_DEPROVISIONING_DETAIL_TYPE=$CDK_PARAM_OFFBOARDING_DETAIL_TYPE
export CDK_PARAM_TIER='basic'
export CDK_PARAM_STAGE='prod'
export CDK_ADV_CLUSTER='INACTIV'
export CDK_BASIC_CLUSTER="$CDK_PARAM_STAGE-$CDK_PARAM_TIER"


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

### export DEPLOY_ENV=true
# npx cdk deploy shared-infra-stack --require-approval=any-change 

# Detect OS type and skip ARM64 setup on Mac
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "Detected macOS - skipping ARM64 emulation setup"
else
    # Make the script executable
    chmod +x ../scripts/utils/setup_multiarch.sh

    # Run the setup_multiarch.sh script
    echo "Running setup_multiarch.sh to configure ARM64 emulation..."
    ../scripts/utils/setup_multiarch.sh

    # Create a symlink in /usr/local/bin for global access
    sudo ln -sf ../scripts/utils/setup_multiarch.sh /usr/local/bin/setup_multiarch

    echo "ARM64 emulation setup complete!"
    echo "You can run 'setup_multiarch' command anytime to refresh the configuration"
fi
# End Multi Architecture Setting

# Deploy shared infrastructure first
npx cdk deploy shared-infra-stack --require-approval never --concurrency 10 --asset-parallelism true

# Deploy tenant stacks sequentially (CDK synthesis requires sequential execution)
CDK_PARAM_TENANT_ID=basic CDK_PARAM_TIER=basic npx cdk deploy tenant-template-stack-basic --exclusively --require-approval never --concurrency 10 --asset-parallelism true
CDK_PARAM_TENANT_ID=advanced CDK_PARAM_TIER=advanced CDK_ADV_CLUSTER=INACTIVE npx cdk deploy tenant-template-stack-advanced --exclusively --require-approval never --concurrency 10 --asset-parallelism true
# 