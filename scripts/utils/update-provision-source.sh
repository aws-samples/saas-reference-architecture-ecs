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

echo "Current directory: $(pwd)"
# echo "Analyzing server folder contents..."
# echo "Server folder size:"
# du -sh server/ 2>/dev/null || echo "Cannot calculate size"
# echo "File count in server folder:"
# find server/ -type f | wc -l
# echo "Largest files in server folder:"
# find server/ -type f -exec ls -lh {} + 2>/dev/null | sort -k5 -hr | head -10

echo "Starting TAR creation with explicit file specification..."
echo "Timestamp: $(date)"

# Create TAR with server and scripts folders
tar -czf source.tar.gz \
  --exclude="server/node_modules" \
  --exclude="server/cdk.out" \
  --exclude="server/.aws-sam" \
  --exclude="server/application" \
  --exclude="server/lib/**/*.js" \
  --exclude="server/lib/**/*.d.ts" \
  server/ \
  scripts/ 2>/dev/null || true

echo "TAR creation completed at: $(date)"
echo "Final TAR file size:"
ls -lh source.tar.gz

echo "Uploading to S3..."
export CDK_PARAM_COMMIT_ID=$(aws s3api put-object --bucket "$CDK_PARAM_S3_BUCKET_NAME" --key "source.tar.gz" --body "./source.tar.gz"  | jq -r '.VersionId')
echo $CDK_PARAM_COMMIT_ID
rm source.tar.gz
cd ./scripts