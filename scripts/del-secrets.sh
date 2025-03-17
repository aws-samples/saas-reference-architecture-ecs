#!/bin/bash

# Get Secrets from AWS Secrets Manager 
SECRET_IDS=$(aws secretsmanager list-secrets \
    --query "SecretList[?contains(Name, 'rds_proxy_multitenant')].ARN" \
    --output text)

# Check if there are any secrets
if [ -z "$SECRET_IDS" ]; then
    echo "No secrets found."
    exit 0
fi

echo "The following secrets will be deleted:"
echo "$SECRET_IDS"

# Delete secrets
for SECRET_ID in $SECRET_IDS; do
    echo "Deleting secret: $SECRET_ID"
    aws secretsmanager delete-secret --secret-id "$SECRET_ID" --force-delete-without-recovery | cat
done

echo "Deletion complete."