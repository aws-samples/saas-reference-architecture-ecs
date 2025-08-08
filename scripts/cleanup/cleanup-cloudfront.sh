#!/bin/bash

echo "$(date) cleaning up remaining CloudFront distributions..."

# Get all CloudFront distributions with SaaSFactory tag
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")
echo "$(date) Account ID: $ACCOUNT_ID"
if [ -z "$ACCOUNT_ID" ]; then
    echo "$(date) Failed to get account ID, skipping CloudFront cleanup"
    exit 0
fi

distributions=$(aws cloudfront list-distributions --query "DistributionList.Items[].Id" --output text 2>/dev/null || true)
echo "$(date) Found distributions: $distributions"
ecs_saas_distributions=""

for dist_id in $distributions; do
    if [ ! -z "$dist_id" ] && [ "$dist_id" != "None" ]; then
        echo "$(date) Checking distribution $dist_id for tags..."
        # Check all tags first
        all_tags=$(aws cloudfront list-tags-for-resource --resource "arn:aws:cloudfront::$ACCOUNT_ID:distribution/$dist_id" --query "Tags.Items" --output json 2>/dev/null || echo "[]")
        echo "$(date) Distribution $dist_id tags: $all_tags"
        
        # Check if distribution has SaaSFactory=ECS-SaaS-Ref tag
        has_tag=$(aws cloudfront list-tags-for-resource --resource "arn:aws:cloudfront::$ACCOUNT_ID:distribution/$dist_id" --query "Tags.Items[?Key=='SaaSFactory' && Value=='ECS-SaaS-Ref']" --output text 2>/dev/null | wc -l)
        echo "$(date) Distribution $dist_id has matching tag: $has_tag"
        if [ "$has_tag" -gt 0 ]; then
            ecs_saas_distributions="$ecs_saas_distributions $dist_id"
            echo "$(date) Added $dist_id to cleanup list"
        fi
    fi
done

distributions="$ecs_saas_distributions"
echo "$(date) Final distributions to cleanup: $distributions"

for dist_id in $distributions; do
    if [ ! -z "$dist_id" ] && [ "$dist_id" != "None" ]; then
        echo "$(date) ========== Processing CloudFront distribution $dist_id =========="
        
        # Check current distribution status
        dist_info=$(aws cloudfront get-distribution --id "$dist_id" 2>/dev/null || echo "{}")
        enabled=$(echo "$dist_info" | jq -r '.Distribution.DistributionConfig.Enabled // "unknown"')
        status=$(echo "$dist_info" | jq -r '.Distribution.Status // "unknown"')
        echo "$(date) Distribution $dist_id - Enabled: $enabled, Status: $status"
        
        if [ "$enabled" = "true" ]; then
            echo "$(date) disabling CloudFront distribution $dist_id..."
            etag=$(aws cloudfront get-distribution --id "$dist_id" --query 'ETag' --output text 2>/dev/null || true)
            echo "$(date) Current ETag: $etag"
            
            if [ ! -z "$etag" ] && [ "$etag" != "None" ]; then
                aws cloudfront get-distribution-config --id "$dist_id" --query 'DistributionConfig' > /tmp/dist-config.json 2>/dev/null
                if [ $? -eq 0 ]; then
                    jq '.Enabled = false' /tmp/dist-config.json > /tmp/dist-config-disabled.json 2>/dev/null
                    if [ $? -eq 0 ]; then
                        update_result=$(aws cloudfront update-distribution --id "$dist_id" --distribution-config file:///tmp/dist-config-disabled.json --if-match "$etag" 2>&1)
                        if [ $? -eq 0 ]; then
                            echo "$(date) successfully disabled distribution $dist_id, waiting for deployment..."
                            aws cloudfront wait distribution-deployed --id "$dist_id" 2>/dev/null
                            echo "$(date) distribution $dist_id deployment completed"
                        else
                            echo "$(date) failed to disable distribution $dist_id: $update_result"
                            continue
                        fi
                    else
                        echo "$(date) failed to modify config for distribution $dist_id"
                        continue
                    fi
                else
                    echo "$(date) failed to get config for distribution $dist_id"
                    continue
                fi
            fi
        else
            echo "$(date) distribution $dist_id is already disabled"
        fi
        
        # Double-check distribution status and deployment state before deletion
        final_enabled=$(aws cloudfront get-distribution --id "$dist_id" --query 'Distribution.DistributionConfig.Enabled' --output text 2>/dev/null || echo "unknown")
        deployment_status=$(aws cloudfront get-distribution --id "$dist_id" --query 'Distribution.Status' --output text 2>/dev/null || echo "unknown")
        echo "$(date) Final check - distribution $dist_id enabled: $final_enabled, status: $deployment_status"
        
        if [ "$final_enabled" = "true" ]; then
            echo "$(date) distribution $dist_id is still enabled, cannot delete"
            continue
        fi
        
        if [ "$deployment_status" != "Deployed" ]; then
            echo "$(date) distribution $dist_id is not fully deployed (status: $deployment_status), waiting..."
            aws cloudfront wait distribution-deployed --id "$dist_id" 2>/dev/null || echo "$(date) wait failed for $dist_id"
            # Re-check status after wait
            deployment_status=$(aws cloudfront get-distribution --id "$dist_id" --query 'Distribution.Status' --output text 2>/dev/null || echo "unknown")
            echo "$(date) After wait - distribution $dist_id status: $deployment_status"
        fi
        
        # Get current etag and delete
        etag=$(aws cloudfront get-distribution --id "$dist_id" --query 'ETag' --output text 2>/dev/null || true)
        echo "$(date) Final ETag for deletion: $etag"
        
        if [ ! -z "$etag" ] && [ "$etag" != "None" ]; then
            echo "$(date) deleting CloudFront distribution $dist_id..."
            delete_result=$(aws cloudfront delete-distribution --id "$dist_id" --if-match "$etag" 2>&1)
            if [ $? -eq 0 ]; then
                echo "$(date) successfully deleted distribution $dist_id"
            else
                echo "$(date) failed to delete distribution $dist_id: $delete_result"
            fi
        fi
        
        rm -f /tmp/dist-config.json /tmp/dist-config-disabled.json 2>/dev/null || true
    fi
done

echo "$(date) CloudFront cleanup completed"