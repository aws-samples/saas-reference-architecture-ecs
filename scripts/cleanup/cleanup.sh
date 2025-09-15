#!/bin/bash -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Find project root by looking for characteristic files
find_project_root() {
    local current_dir="$1"
    while [ "$current_dir" != "/" ]; do
        if [ -f "$current_dir/README.md" ] && [ -d "$current_dir/server" ] && [ -d "$current_dir/scripts" ]; then
            echo "$current_dir"
            return 0
        fi
        current_dir="$(dirname "$current_dir")"
    done
    echo ""
    return 1
}

# Get the project root directory
PROJECT_ROOT="$(find_project_root "$SCRIPT_DIR")"
if [ -z "$PROJECT_ROOT" ]; then
    echo "Error: Could not find project root directory"
    exit 1
fi

echo "Project root found at: $PROJECT_ROOT"

confirm() {
    RED='\033[0;31m'
    BOLD='\033[1m'
    NC='\033[0m' # No Color
    echo ""
    echo -e "${RED}${BOLD}=============================================="
    echo -e " ** WARNING! This ACTION IS IRREVERSIBLE! **"
    echo -e "==============================================${NC}"
    echo ""
    echo "You are about to delete all SaaS ECS reference Architecture resources."
    echo "Do you want to continue?" 
    read -rp "[y/N] " response
    case "$response" in
        [yY][eE][sS]|[yY]) return 0 ;;
        *) return 1 ;;
    esac
}

if ! confirm; then
    echo "Cleanup cancelled"
    exit 1
fi

export REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "$(date) disabling access logging to prevent new logs during cleanup..."
# Disable access logging on all buckets first
for i in $(aws s3 ls | awk '{print $3}' | grep -E "^tenant-update-stack-*|^controlplane-stack-*|^core-appplane-*|^saas-reference-architecture-*|^shared-infra-stack-*"); do
    if [[ ${i} != *"accesslog"* ]]; then
        echo "$(date) disabling access logging for bucket s3://${i}..."
        aws s3api put-bucket-logging --bucket "$i" --bucket-logging-status '{}' 2>/dev/null || true
    fi
done

# Wait a moment for logging to stop
echo "$(date) waiting 10 seconds for access logging to stop..."
sleep 10

echo "$(date) emptying out buckets..."
for i in $(aws s3 ls | awk '{print $3}' | grep -E "^tenant-update-stack-*|^controlplane-stack-*|^core-appplane-*|^saas-reference-architecture-*|^shared-infra-stack-*"); do
    echo "$(date) emptying out s3 bucket with name s3://${i}..."
    aws s3 rm --recursive "s3://${i}"

    if [[ ${i} == *"accesslog"* ]]; then
        aws s3 rb --force "s3://${i}" #delete in stack
    fi
done

SECRETS_RESOURCES=$(aws cloudformation describe-stack-resources --stack-name 'shared-infra-stack' --query "StackResources[?ResourceType=='AWS::SecretsManager::Secret']" --output text | true)
if [ -z "$SECRETS_RESOURCES" ]; then
  :
else
  echo "$SECRETS_RESOURCES"
  sh "$PROJECT_ROOT/scripts/cleanup/cleanup-secrets.sh"
fi

cd "$PROJECT_ROOT/server"
npm install

export CDK_PARAM_SYSTEM_ADMIN_EMAIL="NA"
export CDK_PARAM_S3_BUCKET_NAME="saas-reference-architecture-ecs-$ACCOUNT_ID-$REGION"
export CDK_PARAM_COMMIT_ID="NA"
export CDK_PARAM_REG_API_GATEWAY_URL="NA"
export CDK_PARAM_EVENT_BUS_ARN=arn:aws:service:::resource
export CDK_PARAM_CONTROL_PLANE_SOURCE="NA"
export CDK_PARAM_ONBOARDING_DETAIL_TYPE="NA"
export CDK_PARAM_PROVISIONING_DETAIL_TYPE="NA"
export CDK_PARAM_PROVISIONING_EVENT_SOURCE="NA"
export CDK_PARAM_APPLICATION_NAME_PLANE_SOURCE="NA"
export CDK_PARAM_OFFBOARDING_DETAIL_TYPE="NA"
export CDK_PARAM_DEPROVISIONING_DETAIL_TYPE="NA"
export CDK_PARAM_TIER='basic'

TEMP_FILE=$(mktemp)
# Deleting object version..." 
echo "Deleting Provision sourcecode Object Versions..."
versions=$(aws s3api list-object-versions --bucket $CDK_PARAM_S3_BUCKET_NAME --query 'length(Versions)' --output text 2>/dev/null || echo "0")

if [ ! -z "$versions" ] && [ "$versions" -gt 0 ]; then 
	aws s3api list-object-versions --bucket $CDK_PARAM_S3_BUCKET_NAME --query '{Objects: Versions[].{Key: Key, VersionId: VersionId}}' --output json > $TEMP_FILE
	aws s3api delete-objects --bucket $CDK_PARAM_S3_BUCKET_NAME --delete file://$TEMP_FILE --no-cli-pager
fi 

# Deleting object markers 
echo "Deleting Provision sourcecode Object Markers..." 
delete_markers=$(aws s3api list-object-versions --bucket $CDK_PARAM_S3_BUCKET_NAME --query 'length(DeleteMarkers)' --output text 2>/dev/null || echo "0") 

if [ ! -z "$delete_markers" ] && [ "$delete_markers" -gt 0 ]; then 
	aws s3api list-object-versions --bucket $CDK_PARAM_S3_BUCKET_NAME --query '{Objects: DeleteMarkers[].{Key: Key, VersionId: VersionId}}' --output json > $TEMP_FILE
	aws s3api delete-objects --bucket $CDK_PARAM_S3_BUCKET_NAME --delete file://$TEMP_FILE --no-cli-pager
fi


echo "$(date) cleaning up tenants..."
next_token=""
STACK_STATUS_FILTER="CREATE_COMPLETE ROLLBACK_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE IMPORT_COMPLETE IMPORT_ROLLBACK_COMPLETE"
while true; do
    if [[ "${next_token}" == "" ]]; then
        echo "$(date) making api call to search for tenants..."
        # shellcheck disable=SC2086
        # ignore shellcheck error for adding a quote as that causes the api call to fail
        response=$(aws cloudformation list-stacks --stack-status-filter $STACK_STATUS_FILTER | sed 's/\\n//')
    else
        echo "$(date) making api call to search for tenants..."
        # shellcheck disable=SC2086
        # ignore shellcheck error for adding a quote as that causes the api call to fail
        response=$(aws cloudformation list-stacks --stack-status-filter $STACK_STATUS_FILTER --starting-token "$next_token"| sed 's/\\n//')
    fi

    tenant_stacks=$(aws cloudformation list-stacks --stack-status-filter $STACK_STATUS_FILTER --query 'StackSummaries[?starts_with(StackName, `tenant-template-stack`)].StackName' --output text)

    for i in $tenant_stacks; do
        export CDK_PARAM_TENANT_ID=$(echo "$i" | cut -d '-' -f5-)
        #npx cdk destroy "$i" --force
        aws cloudformation delete-stack --stack-name "$i"
        echo "$(date) waiting for stack delete operation to complete..."
        aws cloudformation wait stack-delete-complete --stack-name "$i" || echo "$(date) stack delete failed for $i, continuing..."        
    done

    next_token=$(aws cloudformation list-stacks --stack-status-filter $STACK_STATUS_FILTER --query 'NextToken' --output text 2>/dev/null || echo "null")
    if [[ "${next_token}" == "null" ]]; then
        echo "$(date) no more tenants left."
        # no more results left. Exit loop...
        break
    fi
done


# Destroy stacks
npx cdk destroy --all --force || echo "$(date) stack destroy failed, continuing..."

echo "$(date) cleaning up user pools..."
next_token=""
while true; do
    if [[ "${next_token}" == "" ]]; then
        response=$( aws cognito-idp list-user-pools --max-results 1)
    else
        # using next-token instead of starting-token. See: https://github.com/aws/aws-cli/issues/7661
        response=$( aws cognito-idp list-user-pools --max-results 1 --next-token "$next_token")
    fi

    pool_ids=$(aws cognito-idp list-user-pools --max-results 1 --query 'UserPools[?Name==`SaaSControlPlaneUserPool`].Id' --output text)
    for i in $pool_ids; do
        echo "$(date) deleting user pool with name $i..."
        echo "getting pool domain..."
        pool_domain=$(aws cognito-idp describe-user-pool --user-pool-id "$i" --query 'UserPool.Domain' --output text)

        echo "deleting pool domain $pool_domain..."
        aws cognito-idp delete-user-pool-domain \
            --user-pool-id "$i" \
            --domain "$pool_domain"

        echo "deleting pool $i..."
        aws cognito-idp delete-user-pool --user-pool-id "$i"
    done

    next_token=$(aws cognito-idp list-user-pools --max-results 1 --query 'NextToken' --output text 2>/dev/null || echo "null")
    if [[ "${next_token}" == "null" ]]; then
        # no more results left. Exit loop...
        break
    fi
done


echo "$(date) removing buckets..."
for i in $(aws s3 ls | awk '{print $3}' | grep -E "^tenant-update-stack-*|^controlplane-stack-*|^core-appplane-*|^saas-reference-architecture-*"); do
    echo "$(date) removing s3 bucket with name s3://${i}..."
    aws s3 rm --recursive "s3://${i}"
    
    # Handle versioned objects and delete markers
    TEMP_FILE_BUCKET=$(mktemp)
    echo "Deleting object versions for bucket ${i}..."
    versions=$(aws s3api list-object-versions --bucket "$i" --query 'length(Versions)' --output text 2>/dev/null || echo "0")
    
    if [ "$versions" -gt 0 ]; then 
        aws s3api list-object-versions --bucket "$i" --query '{Objects: Versions[].{Key: Key, VersionId: VersionId}}' --output json > $TEMP_FILE_BUCKET
        aws s3api delete-objects --bucket "$i" --delete file://$TEMP_FILE_BUCKET --no-cli-pager 2>/dev/null || true
    fi 
    
    echo "Deleting delete markers for bucket ${i}..."
    delete_markers=$(aws s3api list-object-versions --bucket "$i" --query 'length(DeleteMarkers)' --output text 2>/dev/null || echo "0")
    
    if [ "$delete_markers" -gt 0 ]; then 
        aws s3api list-object-versions --bucket "$i" --query '{Objects: DeleteMarkers[].{Key: Key, VersionId: VersionId}}' --output json > $TEMP_FILE_BUCKET
        aws s3api delete-objects --bucket "$i" --delete file://$TEMP_FILE_BUCKET --no-cli-pager 2>/dev/null || true
    fi
    
    # Force delete bucket
    aws s3 rb --force "s3://${i}" 2>/dev/null || echo "$(date) Failed to delete bucket ${i}, may require manual cleanup"
    rm -f $TEMP_FILE_BUCKET
done

# Clean up CloudFront distributions
echo "$(date) running CloudFront cleanup..."
"$PROJECT_ROOT/scripts/cleanup/cleanup-cloudfront.sh" || echo "$(date) CloudFront cleanup failed, continuing..."

# Clean up Cognito User Pools
echo "$(date) running Cognito User Pool cleanup..."
"$PROJECT_ROOT/scripts/cleanup/cleanup-cognito.sh" || echo "$(date) Cognito cleanup failed, continuing..."


#delete ecr repositories
SERVICE_REPOS=("user" "product" "order" "rproxy")
for SERVICE in "${SERVICE_REPOS[@]}"; do
  echo "Repository [$SERVICE] checking..."
  REPO_EXISTS=$(aws ecr describe-repositories --repository-names "$SERVICE" --query 'repositories[0].repositoryUri' --output text --no-cli-pager 2>/dev/null || echo "NOT_FOUND")
  if [ "$REPO_EXISTS" != "NOT_FOUND" ] && [ "$REPO_EXISTS" != "None" ]; then
    echo "Repository [$REPO_EXISTS] is deleting..."
    aws ecr delete-repository --repository-name "$SERVICE" --force --no-cli-pager 2>/dev/null || echo "Failed to delete repository [$SERVICE]"
  else
    echo "Repository [$SERVICE] does not exist"
  fi
done

# Clean up API keys file
API_KEYS_FILE="$PROJECT_ROOT/scripts/.api-keys.env"
if [ -f "$API_KEYS_FILE" ]; then
    echo "$(date) removing API keys file: $API_KEYS_FILE"
    rm -f "$API_KEYS_FILE"
    echo "$(date) API keys file removed successfully"
else
    echo "$(date) API keys file not found, skipping removal"
fi

echo "$(date) cleanup completed!"