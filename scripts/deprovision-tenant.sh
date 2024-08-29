#!/bin/bash -e

# Install dependencies
sudo yum update -y
sudo yum install -y nodejs
sudo yum install -y npm
sudo npm install -g aws-cdk
sudo yum install -y jq
sudo yum install -y python3-pip
sudo python3 -m pip install --upgrade setuptools

# Enable nocasematch option
shopt -s nocasematch


# Parse tenant details from the input message from step function
export CDK_PARAM_TENANT_ID=$tenantId
export TIER=$tier
export CDK_PARAM_TIER=$TIER

export REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Define variables
STACK_NAME="tenant-template-stack-basic"
USER_POOL_OUTPUT_PARAM_NAME="TenantUserpoolId"
PRODUCT_TABLE_OUTPUT_PARAM_NAME="productsTableName"
ORDER_TABLE_OUTPUT_PARAM_NAME="ordersTableName"

# Delete tenant items 
delete_items_if_exists() {
  TABLE_NAME="$1"
  TENANT_ID="$2"
  SUFFIX_START=1
  SUFFIX_END=10

  TABLE_INFO=$(aws dynamodb describe-table \
    --table-name "$TABLE_NAME")

  # Extract the partition key and sort key attribute names
  PARTITION_KEY_NAME=$(echo "$TABLE_INFO" | jq -r '.Table.KeySchema[] | select(.KeyType == "HASH") | .AttributeName')
  SORT_KEY_NAME=$(echo "$TABLE_INFO" | jq -r '.Table.KeySchema[] | select(.KeyType == "RANGE") | .AttributeName')


  # for ((SUFFIX=SUFFIX_START; SUFFIX<=SUFFIX_END; SUFFIX++)); do
    #PARTITION_KEY_VALUE="$TENANT_ID-$SUFFIX"
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
  # done
}

# Un deploy the tenant template for premium tier(silo)
if [[ $TIER == "PREMIUM" || $TIER == "ADVANCED" ]]; then

  STACK_NAME=$(aws dynamodb get-item \
  --table-name $TENANT_STACK_MAPPING_TABLE  \
  --key "{\"tenantId\": {\"S\": \"$CDK_PARAM_TENANT_ID\"}}" \
  --query 'Item.stackName.S')
  STACK_NAME=$(sed -e 's/^"//' -e 's/"$//' <<<$STACK_NAME)
  echo "Stack name from $TENANT_STACK_MAPPING_TABLE is  $STACK_NAME"
  # Copy to S3 Bucket
  export CDK_PARAM_S3_BUCKET_NAME="saas-reference-architecture-ecs-$ACCOUNT_ID-$REGION"
  export CDK_SOURCE_NAME="source.zip"
  CDK_PARAM_COMMIT_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='S3SourceVersion'].OutputValue" --output text)

  aws s3api get-object --bucket "$CDK_PARAM_S3_BUCKET_NAME" --key "$CDK_SOURCE_NAME" --version-id "$CDK_PARAM_COMMIT_ID" "$CDK_SOURCE_NAME" 2>&1 
  unzip $CDK_SOURCE_NAME
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
  
  echo "undeploying tenant template $STACK_NAME"
  npx cdk destroy $STACK_NAME --force

else
  # Read tenant details from the cloudformation stack output parameters
  SAAS_APP_USERPOOL_ID=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='$USER_POOL_OUTPUT_PARAM_NAME'].OutputValue" --output text)
  
  NESTED_NAME=$(aws cloudformation describe-stack-resources --stack-name $STACK_NAME | jq -rc '.StackResources | .[] | select(.ResourceType=="AWS::CloudFormation::Stack") | .PhysicalResourceId | split("/")[1]')

  PRODUCT_TABLE_NAME=$(aws cloudformation describe-stacks --stack-name $NESTED_NAME --query "Stacks[0].Outputs[?OutputKey=='$PRODUCT_TABLE_OUTPUT_PARAM_NAME'].OutputValue" --output text)
  ORDER_TABLE_NAME=$(aws cloudformation describe-stacks --stack-name $NESTED_NAME --query "Stacks[0].Outputs[?OutputKey=='$ORDER_TABLE_OUTPUT_PARAM_NAME'].OutputValue" --output text)

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

  # Delete tenant items from the product and order tables
  delete_items_if_exists $PRODUCT_TABLE_NAME $CDK_PARAM_TENANT_ID
  delete_items_if_exists $ORDER_TABLE_NAME $CDK_PARAM_TENANT_ID  

fi

# Create JSON response of output parameters
export tenantStatus="Deleted"

