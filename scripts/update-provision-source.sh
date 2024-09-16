#!/bin/bash -e


REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')  # Region setting
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Create S3 Bucket for provision source.
export CDK_PARAM_S3_BUCKET_NAME="saas-reference-architecture-ecs-$ACCOUNT_ID-$REGION"

if aws s3api head-bucket --bucket $CDK_PARAM_S3_BUCKET_NAME >/dev/null 2>&1; then
    echo "Bucket $CDK_PARAM_S3_BUCKET_NAME already exists."
else
    echo "Bucket $CDK_PARAM_S3_BUCKET_NAME does not exist. Creating a new bucket in $REGION region in $ACCOUNT_ID"

    if [ "$REGION" == "us-east-1" ]; then
      aws s3api create-bucket --bucket $CDK_PARAM_S3_BUCKET_NAME | cat
    else
      aws s3api create-bucket \
        --bucket $CDK_PARAM_S3_BUCKET_NAME \
        --region "$REGION" \
        --create-bucket-configuration LocationConstraint="$REGION" | cat
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
export CDK_PARAM_COMMIT_ID=$(aws s3api put-object --bucket "$CDK_PARAM_S3_BUCKET_NAME" --key "source.zip" --body "./source.zip"  | jq -r '.VersionId')
echo $CDK_PARAM_COMMIT_ID
rm source.zip
cd ./scripts