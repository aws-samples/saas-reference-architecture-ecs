#!/bin/bash

echo "$(date) cleaning up Cognito User Pools with SaaSFactory tag..."

# Get all User Pools
user_pools=$(aws cognito-idp list-user-pools --max-results 60 --query 'UserPools[].Id' --output text 2>/dev/null || true)
echo "$(date) Found user pools: $user_pools"

saas_user_pools=""

for pool_id in $user_pools; do
    if [ ! -z "$pool_id" ] && [ "$pool_id" != "None" ]; then
        echo "$(date) Checking user pool $pool_id for tags..."
        
        # Check if user pool has SaaSFactory=ECS-SaaS-Ref tag
        has_tag=$(aws cognito-idp list-tags-for-resource --resource-arn "arn:aws:cognito-idp:$(aws configure get region):$(aws sts get-caller-identity --query Account --output text):userpool/$pool_id" --query "Tags.SaaSFactory" --output text 2>/dev/null || echo "")
        
        echo "$(date) User pool $pool_id SaaSFactory tag: $has_tag"
        
        if [ "$has_tag" = "ECS-SaaS-Ref" ]; then
            saas_user_pools="$saas_user_pools $pool_id"
            echo "$(date) Added $pool_id to cleanup list"
        fi
    fi
done

echo "$(date) User pools to cleanup: $saas_user_pools"

for pool_id in $saas_user_pools; do
    if [ ! -z "$pool_id" ] && [ "$pool_id" != "None" ]; then
        echo "$(date) Deleting user pool $pool_id..."
        
        # Get pool domain if exists
        pool_domain=$(aws cognito-idp describe-user-pool --user-pool-id "$pool_id" --query 'UserPool.Domain' --output text 2>/dev/null || echo "None")
        
        if [ "$pool_domain" != "None" ] && [ ! -z "$pool_domain" ]; then
            echo "$(date) Deleting pool domain $pool_domain..."
            aws cognito-idp delete-user-pool-domain --user-pool-id "$pool_id" --domain "$pool_domain" 2>/dev/null || echo "$(date) Failed to delete domain, continuing..."
        fi
        
        # Delete the user pool
        delete_result=$(aws cognito-idp delete-user-pool --user-pool-id "$pool_id" 2>&1)
        if [ $? -eq 0 ]; then
            echo "$(date) Successfully deleted user pool $pool_id"
        else
            echo "$(date) Failed to delete user pool $pool_id: $delete_result"
        fi
    fi
done

echo "$(date) Cognito User Pool cleanup completed"