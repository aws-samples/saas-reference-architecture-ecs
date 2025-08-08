#!/bin/bash

export IMAGE_NAME="$1"
export TENANT="$2"

if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <image-name> <tenant>"
    exit 1  
fi

SERVICE_NAME="${IMAGE_NAME}${TENANT}"

CLUSTER_NAME=$(aws ecs list-clusters --query 'clusterArns[*]' --output json | jq -r '.[] | select(contains("/prod-advanced-")) | split("/") | .[1]') 

# Step 1: Get the Task ARN
TASK_ARN=$(aws ecs list-tasks --cluster $CLUSTER_NAME --service-name $SERVICE_NAME --query 'taskArns[0]' --output text)
TASK_ID=$(echo "$TASK_ARN" | awk -F'/' '{print $NF}' )
# Check if TASK_ARN is empty
if [ -z "$TASK_ARN" ]; then
    echo "No tasks found for service $SERVICE_NAME in cluster $CLUSTER_NAME"
    exit 1
fi

export SECURITY_GROUP=$(aws ecs describe-services --cluster $CLUSTER_NAME --services $SERVICE_NAME --query 'services[0].networkConfiguration.awsvpcConfiguration.securityGroups' --output text)

# Step 2: Get the ENI ID
export PRIVATE_IP=$(aws ecs describe-tasks --cluster $CLUSTER_NAME --tasks $TASK_ARN --query 'tasks[0].attachments[?type==`ElasticNetworkInterface`][].details[?name==`privateIPv4Address`].value | [0]' --output text)

# Output the Private IP
echo "CLUSTER_NAME  : $CLUSTER_NAME"
echo "TASK ID       : $TASK_ID"
echo "Security Group: $SECURITY_GROUP"
echo "Private IP    : $PRIVATE_IP"
echo "curl http://$PRIVATE_IP:3010/${IMAGE_NAME}"
