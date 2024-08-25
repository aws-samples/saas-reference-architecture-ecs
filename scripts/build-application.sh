#!/bin/bash

# build and push application services into ECR

export DOCKER_DEFAULT_PLATFORM=linux/amd64

service_repos=("user" "product" "order" "rproxy")

deploy_service () {

    local SERVICE_NAME="$1"

    if [[ -z "$SERVICE_NAME" ]]; then
      echo "Please provide a SERVICE NAME"
      exit 1
    fi

    local REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')
    local ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    local SERVICEECR="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/$SERVICE_NAME"

    CWD=$(pwd)
    cd ../server/application
    local REGISTRY=$(echo $SERVICEECR| cut -d'/' -f 1)

    aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $REGISTRY
    docker build -t $SERVICEECR -f Dockerfile.$SERVICE_NAME .
    docker push $SERVICEECR:latest

    cd $CWD
    echo '************************' 
    echo '************************' 
    echo ""
    echo "$SERVICE_NAME SERVICE_ECR_REPO:" $SERVICEECR
    echo "AWS_REGION:" $REGION

}

##export service_repos;
for repository in "${service_repos[@]}"
do
echo $repository
  aws ecr describe-repositories --repository-names "$repository" 2>/dev/null || echo "ECR Repository '$repository' does not exist. Creating..." && 
  aws ecr create-repository --repository-name "$repository"
  deploy_service $repository
done
