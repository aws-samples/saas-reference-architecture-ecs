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

REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')  # Region setting
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

export CDK_PARAM_S3_BUCKET_NAME="saas-reference-architecture-ecs-$ACCOUNT_ID-$REGION"
CDK_SOURCE_NAME="source.tar.gz"

VERSIONS=$(aws s3api list-object-versions --bucket "$CDK_PARAM_S3_BUCKET_NAME" --prefix "$CDK_SOURCE_NAME" --query 'Versions[?IsLatest==`true`].{VersionId:VersionId}' --output text 2>&1)
export CDK_PARAM_COMMIT_ID=$(echo "$VERSIONS" | awk 'NR==1{print $1}')

cd ../server

# npx cdk bootstrap
export CDK_PARAM_TIER='basic'
RDS_RESOURCES=$(aws cloudformation describe-stack-resources --stack-name 'shared-infra-stack' --query "StackResources[?ResourceType=='AWS::RDS::DBInstance']" --output text)
if [ -z "$RDS_RESOURCES" ] 
then
  export CDK_USE_DB='dynamodb'
else
  export CDK_USE_DB='mysql'
fi
echo "DB_TYPE:$CDK_USE_DB"

npm install
#npx cdk deploy --all --require-approval=never
npx cdk deploy \
    controlplane-stack \
    core-appplane-stack \
    --require-approval never #--verbose ##--concurrency 10 --asset-parallelism true

# Get SaaS application url
ADMIN_SITE_URL=$(aws cloudformation describe-stacks --stack-name shared-infra-stack --query "Stacks[0].Outputs[?OutputKey=='adminSiteUrl'].OutputValue" --output text)
APP_SITE_URL=$(aws cloudformation describe-stacks --stack-name shared-infra-stack --query "Stacks[0].Outputs[?OutputKey=='appSiteUrl'].OutputValue" --output text)
echo "Admin site url: $ADMIN_SITE_URL"
echo "Application site url: $APP_SITE_URL"