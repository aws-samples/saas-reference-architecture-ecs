#!/bin/bash -e

export CDK_PARAM_SYSTEM_ADMIN_EMAIL="$1"

if [[ -z "$CDK_PARAM_SYSTEM_ADMIN_EMAIL" ]]; then
  echo "Please provide system admin email"
  exit 1
fi

# Create CodeCommit repo
REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')  # Region setting
export CDK_PARAM_CODE_COMMIT_REPOSITORY_NAME="saas-reference-architecture-ecs"
if ! aws codecommit get-repository --repository-name $CDK_PARAM_CODE_COMMIT_REPOSITORY_NAME; then
  CREATE_REPO=$(aws codecommit create-repository --repository-name $CDK_PARAM_CODE_COMMIT_REPOSITORY_NAME --repository-description "ECS saas reference architecture repository")
  echo "$CREATE_REPO"
fi

REPO_URL="codecommit::${REGION}://$CDK_PARAM_CODE_COMMIT_REPOSITORY_NAME" ## CodeCommit URL setting
if ! git remote add cc "$REPO_URL"; then
  echo "Setting url to remote cc"
  git remote set-url cc "$REPO_URL"
fi
git push cc "$(git branch --show-current)":main -f --no-verify
export CDK_PARAM_COMMIT_ID=$(git log --format="%H" -n 1)

# Create ECS service linked role.
aws iam create-service-linked-role --aws-service-name ecs.amazonaws.com 2>/dev/null || echo "ECS Service linked role exists"

# Preprovision basic infrastructure
cd ../server

export ECR_REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
sed "s/<REGION>/$ECR_REGION/g; s/<ACCOUNT_ID>/$ACCOUNT_ID/g" ./service-info.txt > ./lib/service-info.json

npm install

# npx cdk bootstrap
export CDK_PARAM_CONTROL_PLANE_SOURCE='sbt-control-plane-api' # 'controlPlaneEventSource'
export CDK_PARAM_ONBOARDING_DETAIL_TYPE='Onboarding'
export CDK_PARAM_PROVISIONING_DETAIL_TYPE=$CDK_PARAM_ONBOARDING_DETAIL_TYPE
export CDK_PARAM_APPLICATION_NAME_PLANE_SOURCE='sbt-application-plane-api' # 'applicationPlaneEventSource'
export CDK_PARAM_OFFBOARDING_DETAIL_TYPE='Offboarding'
export CDK_PARAM_DEPROVISIONING_DETAIL_TYPE=$CDK_PARAM_OFFBOARDING_DETAIL_TYPE
export CDK_PARAM_TIER='basic'

npx cdk bootstrap
npx cdk deploy --all --require-approval never #--concurrency 10 --asset-parallelism true 


# Get SaaS application url
ADMIN_SITE_URL=$(aws cloudformation describe-stacks --stack-name controlplane-stack --query "Stacks[0].Outputs[?OutputKey=='adminSiteUrl'].OutputValue" --output text)
APP_SITE_URL=$(aws cloudformation describe-stacks --stack-name core-appplane-stack --query "Stacks[0].Outputs[?OutputKey=='appSiteUrl'].OutputValue" --output text)
echo "Admin site url: $ADMIN_SITE_URL"
echo "Application site url: $APP_SITE_URL"