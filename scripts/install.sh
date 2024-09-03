#!/bin/bash

export CDK_PARAM_SYSTEM_ADMIN_EMAIL="$1"

if [[ -z "$CDK_PARAM_SYSTEM_ADMIN_EMAIL" ]]; then
  echo "Please provide system admin email"
  exit 1
fi

REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')  # Region setting
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

export CDK_PARAM_S3_BUCKET_NAME="saas-reference-architecture-ecs-$ACCOUNT_ID-$REGION"

# Create S3 Bucket for provision source.

if aws s3api head-bucket --bucket $CDK_PARAM_S3_BUCKET_NAME 2>/dev/null; then
    echo "Bucket $CDK_PARAM_S3_BUCKET_NAME already exists."
else
    echo "Bucket $CDK_PARAM_S3_BUCKET_NAME does not exist. Creating a new bucket in $REGION region in $ACCOUNT_ID"

    if [ "$REGION" == "us-east-1" ]; then
      aws s3api create-bucket --bucket $CDK_PARAM_S3_BUCKET_NAME
    else
      aws s3api create-bucket \
        --bucket $CDK_PARAM_S3_BUCKET_NAME \
        --region "$REGION" \
        --create-bucket-configuration LocationConstraint="$REGION" 
    fi

    aws s3api put-bucket-versioning \
        --bucket $CDK_PARAM_S3_BUCKET_NAME \
        --versioning-configuration Status=Enabled

    aws s3api put-public-access-block \
        --bucket $CDK_PARAM_S3_BUCKET_NAME \
        --public-access-block-configuration \
        BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true    

    if [ $? -eq 0 ]; then
        echo "Bucket $CDK_PARAM_S3_BUCKET_NAME created with versioning enabled."
    else
        echo "Error creating bucket $CDK_PARAM_S3_BUCKET_NAME with versioning enabled."
        exit 1
    fi
fi

echo "Bucket exists: $CDK_PARAM_S3_BUCKET_NAME"

cd ../
zip -rq source.zip . -x ".git/*" -x "**/node_modules/*" -x "**/cdk.out/*" -x "**/.aws-sam/*" 
export CDK_PARAM_COMMIT_ID=$(aws s3api put-object --bucket "${CDK_PARAM_S3_BUCKET_NAME}" --key "source.zip" --body "./source.zip"  --output text)

rm source.zip
echo "Source code uploaded to S3"

# Create ECS service linked role.
aws iam create-service-linked-role --aws-service-name ecs.amazonaws.com 2>/dev/null || echo "ECS Service linked role exists"

# Preprovision basic infrastructure
cd ./server

export ECR_REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
sed "s/<REGION>/$ECR_REGION/g; s/<ACCOUNT_ID>/$ACCOUNT_ID/g" ./service-info.txt > ./lib/service-info.json
# npx cdk bootstrap
export CDK_PARAM_ONBOARDING_DETAIL_TYPE='Onboarding'
export CDK_PARAM_PROVISIONING_DETAIL_TYPE=$CDK_PARAM_ONBOARDING_DETAIL_TYPE
export CDK_PARAM_OFFBOARDING_DETAIL_TYPE='Offboarding'
export CDK_PARAM_DEPROVISIONING_DETAIL_TYPE=$CDK_PARAM_OFFBOARDING_DETAIL_TYPE
export CDK_PARAM_TIER='basic'
export CDK_PARAM_STAGE='prod'

export CDK_BASIC_CLUSTER="$CDK_PARAM_STAGE-$CDK_PARAM_TIER"

npm install
npx cdk bootstrap

npx cdk diff tenant-template-stack-basic > ./diff_output.txt 2>&1
if grep -q "There were no differences" ./diff_output.txt; then
    echo "No changes detected in tenant-template-stack-basic."
else
    echo "Changes detected in tenant-template-stack-basic."

    SERVICES=$(aws ecs list-services --cluster $CDK_BASIC_CLUSTER --query 'serviceArns[*]' --output text || true)
    for SERVICE in $SERVICES; do
        SERVICE_NAME=$(echo $SERVICE | rev | cut -d '/' -f 1 | rev)

        echo -n "==== Service Connect Disable: "
        aws ecs update-service \
            --cluster $CDK_BASIC_CLUSTER \
            --service $SERVICE_NAME \
            --service-connect-configuration 'enabled=false' \
            --no-cli-pager --query 'service.serviceArn' --output text
    done
fi
rm diff_output.txt

npx cdk deploy --all --require-approval=never


## Get SaaS application url
ADMIN_SITE_URL=$(aws cloudformation describe-stacks --stack-name controlplane-stack --query "Stacks[0].Outputs[?OutputKey=='adminSiteUrl'].OutputValue" --output text)
APP_SITE_URL=$(aws cloudformation describe-stacks --stack-name core-appplane-stack --query "Stacks[0].Outputs[?OutputKey=='appSiteUrl'].OutputValue" --output text)
echo "Admin site url: $ADMIN_SITE_URL"
echo "Application site url: $APP_SITE_URL"