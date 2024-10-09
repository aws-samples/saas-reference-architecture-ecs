#!/bin/bash -e

export CDK_PARAM_SYSTEM_ADMIN_EMAIL="dummy"

export REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')  # Region setting
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Create S3 Bucket for provision source.
source ./update-provision-source.sh

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

if [ $DB_TYPE == 'mysql' ]; then 
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
source /tmp/db_type.env
echo "DB_TYPE: $DB_TYPE"
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

### export DEPLOY_ENV=true
# npx cdk deploy shared-infra-stack --require-approval=never


npx cdk deploy \
    shared-infra-stack \
    tenant-template-stack-basic \
    tenant-template-stack-advanced --require-approval=any-change
# 