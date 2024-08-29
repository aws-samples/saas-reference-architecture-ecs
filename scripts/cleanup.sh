#!/bin/bash -e

confirm() {
    echo ""
    echo "=============================================="
    echo " ** WARNING! This ACTION IS IRREVERSIBLE! **"
    echo "=============================================="
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

echo "$(date) emptying out buckets..."
for i in $(aws s3 ls | awk '{print $3}' | grep -E "^tenant-update-stack-*|^controlplane-stack-*|^core-appplane-*|^saas-reference-architecture-*"); do
    echo "$(date) emptying out s3 bucket with name s3://${i}..."
    aws s3 rm --recursive "s3://${i}"

    if [[ ${i} == *"accesslog"* ]]; then
        aws s3 rb --force "s3://${i}" #delete in stack
    fi
    
done


cd ../server
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
versions=$(aws s3api list-object-versions --bucket $CDK_PARAM_S3_BUCKET_NAME --output json \
      | jq -r '.Versions | length')

if [ "$versions" -gt 0 ]; then 
	aws s3api list-object-versions --bucket $CDK_PARAM_S3_BUCKET_NAME --output json \
		| jq '{"Objects": [.Versions[] | {Key: .Key, VersionId: .VersionId}]}' > $TEMP_FILE
	aws s3api delete-objects --bucket $CDK_PARAM_S3_BUCKET_NAME --delete file://$TEMP_FILE --no-cli-pager
fi 

# Deleting object markers 
echo "Deleting Provision sourcecode Object Markers..." 
delete_markers=$(aws s3api list-object-versions --bucket $CDK_PARAM_S3_BUCKET_NAME --output json \
	| jq -r '.DeleteMarkers | length') 

if [ "$delete_markers" -gt 0 ]; then 
	aws s3api list-object-versions --bucket $CDK_PARAM_S3_BUCKET_NAME --output json \
	    | jq '{"Objects": [.DeleteMarkers[] | {Key: .Key, VersionId: .VersionId}]}' > $TEMP_FILE
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

    tenant_stacks=$(echo "$response" | jq -r '.StackSummaries[].StackName | select(. | test("^tenant-template-stack-*"))')

    for i in $tenant_stacks; do
        export CDK_PARAM_TENANT_ID=$(echo "$i" | cut -d '-' -f5-)
        #npx cdk destroy "$i" --force
        aws cloudformation delete-stack --stack-name "$i"
        echo "$(date) waiting for stack delete operation to complete..."
        aws cloudformation wait stack-delete-complete --stack-name "$i"        
    done

    next_token=$(echo "$response" | jq '.NextToken')
    if [[ "${next_token}" == "null" ]]; then
        echo "$(date) no more tenants left."
        # no more results left. Exit loop...
        break
    fi
done

npx cdk destroy --all --force

echo "$(date) cleaning up user pools..."
next_token=""
while true; do
    if [[ "${next_token}" == "" ]]; then
        response=$( aws cognito-idp list-user-pools --max-results 1)
    else
        # using next-token instead of starting-token. See: https://github.com/aws/aws-cli/issues/7661
        response=$( aws cognito-idp list-user-pools --max-results 1 --next-token "$next_token")
    fi

    pool_ids=$(echo "$response" | jq -r '.UserPools[] | select(.Name | test("^SaaSControlPlaneUserPool$")) |.Id')
    for i in $pool_ids; do
        echo "$(date) deleting user pool with name $i..."
        echo "getting pool domain..."
        pool_domain=$(aws cognito-idp describe-user-pool --user-pool-id "$i" | jq -r '.UserPool.Domain')

        echo "deleting pool domain $pool_domain..."
        aws cognito-idp delete-user-pool-domain \
            --user-pool-id "$i" \
            --domain "$pool_domain"

        echo "deleting pool $i..."
        aws cognito-idp delete-user-pool --user-pool-id "$i"
    done

    next_token=$(echo "$response" | jq -r '.NextToken')
    if [[ "${next_token}" == "null" ]]; then
        # no more results left. Exit loop...
        break
    fi
done


echo "$(date) removing buckets..."
for i in $(aws s3 ls | awk '{print $3}' | grep -E "^tenant-update-stack-*|^controlplane-stack-*|^core-appplane-*|^saas-reference-architecture-*"); do
    echo "$(date) removing s3 bucket with name s3://${i}..."
    aws s3 rm --recursive "s3://${i}"
    aws s3 rb --force "s3://${i}" #delete in stack
done

