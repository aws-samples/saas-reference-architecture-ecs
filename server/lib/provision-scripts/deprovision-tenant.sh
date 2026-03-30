#!/bin/bash -e

# Install only necessary dependencies (most tools already in STANDARD_7_0)
echo "Using pre-installed tools from CodeBuild STANDARD_7_0 image"
node --version
npm --version
aws --version

# Only install CDK (not pre-installed)
sudo npm install -g aws-cdk

# Upgrade setuptools if needed
python3 -m pip install --upgrade setuptools --user

# Enable nocasematch option
shopt -s nocasematch

# Parse tenant details from the input message from step function
export CDK_PARAM_TENANT_ID=$tenantId
export TIER=$tier
export CDK_PARAM_TIER=$TIER
export TENANT_NAME=$tenantName

export REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Auto-detect database type from shared-infra-stack
BOOTSTRAP_STACK_NAME="shared-infra-stack"
RDS_RESOURCES=$(aws cloudformation describe-stack-resources --stack-name "$BOOTSTRAP_STACK_NAME" --query "StackResources[?ResourceType=='AWS::RDS::DBInstance']" --output text)
if [ -z "$RDS_RESOURCES" ]; then
  CDK_USE_DB='dynamodb'
else
  CLUSTER_ID=$(aws cloudformation describe-stack-resources --stack-name "$BOOTSTRAP_STACK_NAME" --query "StackResources[?ResourceType=='AWS::RDS::DBCluster'].PhysicalResourceId" --output text 2>/dev/null || echo "")
  if [ -n "$CLUSTER_ID" ]; then
    ENGINE=$(aws rds describe-db-clusters --db-cluster-identifier "$CLUSTER_ID" --query "DBClusters[0].Engine" --output text 2>/dev/null || echo "")
    if [[ "$ENGINE" == *"postgresql"* ]]; then
      CDK_USE_DB='postgresql'
    else
      CDK_USE_DB='mysql'
    fi
  else
    CDK_USE_DB='mysql'
  fi
fi
echo "CDK_USE_DB: $CDK_USE_DB"

# Resolve tenantName: from event, or from TenantStackMapping DynamoDB table
if [[ -z "$TENANT_NAME" && -n "$TENANT_STACK_MAPPING_TABLE" ]]; then
  echo "tenantName not in event, looking up from $TENANT_STACK_MAPPING_TABLE..."
  TENANT_NAME=$(aws dynamodb get-item \
    --table-name "$TENANT_STACK_MAPPING_TABLE" \
    --key "{\"tenantId\": {\"S\": \"$CDK_PARAM_TENANT_ID\"}}" \
    --query 'Item.tenantName.S' --output text 2>/dev/null || echo "")
  if [[ "$TENANT_NAME" == "None" || -z "$TENANT_NAME" ]]; then
    echo "WARNING: tenantName not found in mapping table for tenantId=$CDK_PARAM_TENANT_ID"
    TENANT_NAME=""
  else
    echo "Resolved tenantName from mapping table: $TENANT_NAME"
  fi
fi

# Define variables
STACK_NAME="tenant-template-stack-basic"
USER_POOL_OUTPUT_PARAM_NAME="TenantUserpoolId"
PRODUCT_TABLE_OUTPUT_PARAM_NAME="productsTableOutputParam"
ORDER_TABLE_OUTPUT_PARAM_NAME="ordersTableOutputParam"
PRODUCT_TABLE_NAME="product-table-basic"
ORDER_TABLE_NAME="order-table-basic"

# RDS cleanup: invoke SchemeLambda with action=delete
# Handles: DROP database/user, remove RDS Proxy Auth, delete Secrets Manager secret
cleanup_rds_tenant() {
  local TENANT_NAME_TO_CLEAN="$1"
  if [[ -z "$TENANT_NAME_TO_CLEAN" ]]; then
    echo "WARNING: tenantName is empty, skipping RDS cleanup"
    return
  fi

  echo "Cleaning up RDS resources for tenant: $TENANT_NAME_TO_CLEAN"
  SCHEME_LAMBDA_ARN=$(aws cloudformation describe-stacks --stack-name "$BOOTSTRAP_STACK_NAME" \
    --query "Stacks[0].Outputs[?ExportName=='SchemeLambdaArn'].OutputValue" --output text 2>/dev/null || echo "")

  if [[ -n "$SCHEME_LAMBDA_ARN" && "$SCHEME_LAMBDA_ARN" != "None" ]]; then
    # Synchronous invoke — wait for cleanup to complete before stack destroy
    aws lambda invoke \
      --function-name "$SCHEME_LAMBDA_ARN" \
      --invocation-type "RequestResponse" \
      --cli-binary-format raw-in-base64-out \
      --payload "{\"tenantName\":\"$TENANT_NAME_TO_CLEAN\",\"action\":\"delete\"}" \
      /tmp/rds-cleanup-response.json

    LAMBDA_RESULT=$(cat /tmp/rds-cleanup-response.json 2>/dev/null || echo "{}")
    echo "RDS cleanup Lambda response: $LAMBDA_RESULT"

    # Check for Lambda error (FunctionError in response)
    if echo "$LAMBDA_RESULT" | grep -qi "error"; then
      echo "WARNING: RDS cleanup Lambda returned error, attempting direct secret cleanup..."
      cleanup_secret_directly "$TENANT_NAME_TO_CLEAN"
    else
      echo "RDS cleanup completed for tenant: $TENANT_NAME_TO_CLEAN"
    fi
  else
    echo "WARNING: SchemeLambdaArn not found. Attempting direct secret cleanup..."
    cleanup_secret_directly "$TENANT_NAME_TO_CLEAN"
  fi
}

# Fallback: directly delete Secrets Manager secret if Lambda is unavailable
cleanup_secret_directly() {
  local TENANT_NAME_TO_CLEAN="$1"
  local SECRET_NAME="rds_proxy_multitenant/proxy_secret_for_user_${TENANT_NAME_TO_CLEAN}"

  echo "Directly deleting secret: $SECRET_NAME"
  aws secretsmanager delete-secret \
    --secret-id "$SECRET_NAME" \
    --force-delete-without-recovery 2>/dev/null || echo "Secret $SECRET_NAME not found or already deleted"
}

# Delete tenant items from DynamoDB
delete_items_if_exists() {
  TABLE_NAME="$1"
  TENANT_ID="$2"

  TABLE_INFO=$(aws dynamodb describe-table \
    --table-name "$TABLE_NAME")

  # Extract the partition key and sort key attribute names
  PARTITION_KEY_NAME=$(echo "$TABLE_INFO" | jq -r '.Table.KeySchema[] | select(.KeyType == "HASH") | .AttributeName')
  SORT_KEY_NAME=$(echo "$TABLE_INFO" | jq -r '.Table.KeySchema[] | select(.KeyType == "RANGE") | .AttributeName')

  PARTITION_KEY_VALUE="$TENANT_ID"

  # Query DynamoDB to get items with the specified partition key value
  QUERY_OUTPUT=$(aws dynamodb query \
    --table-name "$TABLE_NAME" \
    --key-condition-expression "$PARTITION_KEY_NAME = :pk" \
    --expression-attribute-values '{":pk":{"S":"'"$PARTITION_KEY_VALUE"'"}}')

  # Check if items were returned in the query result
  ITEM_COUNT=$(echo "$QUERY_OUTPUT" | jq '.Items | length')

  if [ "$ITEM_COUNT" -gt 0 ]; then
    echo "Items found with PartitionKey = $PARTITION_KEY_VALUE"

    # Loop through the items and extract the PartitionKey and SortKey
    for ITEM in $(echo "$QUERY_OUTPUT" | jq -c '.Items[]'); do
      ITEM_KEY=$(echo "$ITEM" | jq -r '.'$PARTITION_KEY_NAME'.S')
      ITEM_SORT_KEY=$(echo "$ITEM" | jq -r '.'$SORT_KEY_NAME'.S')

      # Delete each item using the PartitionKey and SortKey
      aws dynamodb delete-item \
        --table-name "$TABLE_NAME" \
        --key "{\"$PARTITION_KEY_NAME\":{\"S\":\"$ITEM_KEY\"},\"$SORT_KEY_NAME\":{\"S\":\"$ITEM_SORT_KEY\"}}"

      echo "Deleted item with $PARTITION_KEY_NAME = $ITEM_KEY and $SORT_KEY_NAME = $ITEM_SORT_KEY"
    done
  else
    echo "No items found with PartitionKey = $PARTITION_KEY_VALUE"
  fi
}

# Un deploy the tenant template for premium/advanced tier (silo)
if [[ $TIER == "PREMIUM" || $TIER == "ADVANCED" ]]; then

  STACK_NAME=$(aws dynamodb get-item \
  --table-name $TENANT_STACK_MAPPING_TABLE  \
  --key "{\"tenantId\": {\"S\": \"$CDK_PARAM_TENANT_ID\"}}" \
  --query 'Item.stackName.S')
  STACK_NAME=$(sed -e 's/^"//' -e 's/"$//' <<<$STACK_NAME)
  echo "Stack name from $TENANT_STACK_MAPPING_TABLE is  $STACK_NAME"

  # RDS cleanup BEFORE stack destroy (Lambda needs VPC/RDS access)
  if [[ "$CDK_USE_DB" == "mysql" || "$CDK_USE_DB" == "postgresql" ]]; then
    cleanup_rds_tenant "$TENANT_NAME"
  fi

  # Copy to S3 Bucket
  export CDK_PARAM_S3_BUCKET_NAME="saas-reference-architecture-ecs-$ACCOUNT_ID-$REGION"
  export CDK_SOURCE_NAME="source.tar.gz"
  CDK_PARAM_COMMIT_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='S3SourceVersion'].OutputValue" --output text)

  aws s3api get-object --bucket "$CDK_PARAM_S3_BUCKET_NAME" --key "$CDK_SOURCE_NAME" --version-id "$CDK_PARAM_COMMIT_ID" "$CDK_SOURCE_NAME" 2>&1 
  tar --warning=no-unknown-keyword -xzf $CDK_SOURCE_NAME 2>/dev/null || tar -xzf $CDK_SOURCE_NAME
  cd ./server

  sed "s/<REGION>/$REGION/g; s/<ACCOUNT_ID>/$ACCOUNT_ID/g" ./service-info.txt > ./lib/service-info.json

  npm install

  export CDK_PARAM_SYSTEM_ADMIN_EMAIL="NA"
  export CDK_PARAM_REG_API_GATEWAY_URL="NA"
  export CDK_PARAM_EVENT_BUS_ARN=arn:aws:service:::resource
  export CDK_PARAM_CONTROL_PLANE_SOURCE="NA"
  export CDK_PARAM_ONBOARDING_DETAIL_TYPE="NA"
  export CDK_PARAM_PROVISIONING_DETAIL_TYPE="NA"
  export CDK_PARAM_PROVISIONING_EVENT_SOURCE="NA"
  export CDK_PARAM_APPLICATION_NAME_PLANE_SOURCE="NA"
  export CDK_PARAM_OFFBOARDING_DETAIL_TYPE="NA"
  export CDK_PARAM_DEPROVISIONING_DETAIL_TYPE="NA"
  
  echo "undeploying tenant service stack first"
  SERVICE_STACK_NAME=$(echo $STACK_NAME | sed 's/tenant-template-stack/tenant-service-stack/')
  npx cdk destroy $SERVICE_STACK_NAME --force --concurrency 10 2>/dev/null || true

  echo "undeploying tenant template $STACK_NAME"
  npx cdk destroy $STACK_NAME --force --concurrency 10

else
  # BASIC tier cleanup

  # RDS cleanup for Basic tier
  if [[ "$CDK_USE_DB" == "mysql" || "$CDK_USE_DB" == "postgresql" ]]; then
    cleanup_rds_tenant "$TENANT_NAME"
  fi

  # Read tenant details from the cloudformation stack output parameters
  SAAS_APP_USERPOOL_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='$USER_POOL_OUTPUT_PARAM_NAME'].OutputValue" --output text)
  
  ## Delete tenant users and tenant user groups
  # Get a list of all users in the user group
  USERS=$(aws cognito-idp list-users-in-group --user-pool-id "$SAAS_APP_USERPOOL_ID" --group-name "$CDK_PARAM_TENANT_ID" --query "Users[].Username" --output text)
  # Loop through the list of users and delete each one from the group
  for USERNAME in $USERS; do
    aws cognito-idp admin-delete-user --user-pool-id "$SAAS_APP_USERPOOL_ID" --username "$USERNAME"
    echo "Removed user $USERNAME from group $CDK_PARAM_TENANT_ID"
  done

  # Delete the user group
  aws cognito-idp delete-group --user-pool-id "$SAAS_APP_USERPOOL_ID" --group-name "$CDK_PARAM_TENANT_ID"
  echo "Deleted user group: $CDK_PARAM_TENANT_ID"
  echo "All users have been removed from the group and the group has been deleted."

  # Delete tenant items from the product and order tables (DynamoDB only)
  if [[ "$CDK_USE_DB" != "mysql" && "$CDK_USE_DB" != "postgresql" ]]; then
    delete_items_if_exists $PRODUCT_TABLE_NAME $CDK_PARAM_TENANT_ID
    delete_items_if_exists $ORDER_TABLE_NAME $CDK_PARAM_TENANT_ID
  fi

fi

# Create JSON response of output parameters
export registrationStatus="Deleted"
