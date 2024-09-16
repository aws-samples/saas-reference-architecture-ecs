#!/bin/bash

# build and push application services into ECR

export DOCKER_DEFAULT_PLATFORM=linux/amd64

SERVICE_REPOS=("user" "product" "order" "rproxy")
# RPROXY_VERSIONS=("v1" "v2")

REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin $REGISTRY

deploy_service () {

    local SERVICE_NAME="$1"
    local VERSION="$2"

    if [[ -z "$SERVICE_NAME" ]]; then
      echo "Please provide a SERVICE NAME"
      exit 1
    fi

    local SERVICEECR="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/$SERVICE_NAME"
    # Docker Image Build
    docker build -t $SERVICEECR -f Dockerfile.$SERVICE_NAME .
    # Docker Image Tag
    docker tag "$SERVICEECR" "$SERVICEECR:$VERSION"
    # Docker Image Push to ECR
    docker push "$SERVICEECR:$VERSION"

    echo '************************' 
    echo "AWS_REGION:" $REGION
    echo "$SERVICE_NAME SERVICE_ECR_REPO: $SERVICEECR VERSION: $VERSION"
    

}


CWD=$(pwd)
cd ../server/application

for SERVICE in "${SERVICE_REPOS[@]}"; do
  echo "➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤➤"
  echo "Repository [$SERVICE] checking..."
  REPO_EXISTS=$(aws ecr describe-repositories --repository-names "$SERVICE" --query 'repositories[0].repositoryUri' --output text)

  if [ "$REPO_EXISTS" == "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/$SERVICE" ]; then
    echo "Repository [$SERVICE] already exists."
  else
    echo "Repository [$SERVICE] does not exist, creating it..."
    aws ecr create-repository --repository-name "$SERVICE" | cat 
    echo "Repository [$SERVICE] created."
  fi

  VERSION="latest"
  deploy_service $SERVICE $VERSION
done

cd $CWD

# cloud9 SSM plugins to connect to the inside of Container
# sudo dnf install -y https://s3.amazonaws.com/session-manager-downloads/plugin/latest/linux_64bit/session-manager-plugin.rpm