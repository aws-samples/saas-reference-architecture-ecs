#!/bin/bash -e

echo "$(date) emptying out buckets..."
for i in $(aws s3 ls | awk '{print $3}' | grep -E "^tenant-update-stack-*|^controlplane-stack-*|^coreappplane-*"); do
    echo "$(date) emptying out s3 bucket with name s3://${i}..."
    aws s3 rm --recursive "s3://${i}"

    if [[ ${i} == *"accesslog"* ]]; then
        aws s3 rb --force "s3://${i}" #delete in stack
    fi
    
done


cd ../server
npm install

export CDK_PARAM_SYSTEM_ADMIN_EMAIL="NA"
export CDK_PARAM_CODE_COMMIT_REPOSITORY_NAME="saas-reference-architecture-ecs"
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

if aws codecommit get-repository --repository-name $CDK_PARAM_CODE_COMMIT_REPOSITORY_NAME; then
  DELETE_REPO=$(aws codecommit delete-repository --repository-name $CDK_PARAM_CODE_COMMIT_REPOSITORY_NAME)
  echo "$DELETE_REPO"
fi

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
for i in $(aws s3 ls | awk '{print $3}' | grep -E "^tenant-update-stack-*|^controlplane-stack-*|^coreappplane-*"); do
    echo "$(date) removing s3 bucket with name s3://${i}..."
    aws s3 rm --recursive "s3://${i}"
    aws s3 rb --force "s3://${i}" #delete in stack
done

