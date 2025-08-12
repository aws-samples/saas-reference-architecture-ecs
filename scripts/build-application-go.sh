#!/bin/bash
# Build and push Go microservices to ECR
# Usage: ./build-application-go.sh [version]
# Example: ./build-application-go.sh latest

# Get version from parameter or use default
VERSION_TAG="${1:-go-latest}"
echo "Using version tag: $VERSION_TAG"

# Force enable BuildKit for faster builds
export DOCKER_BUILDKIT=1
export BUILDKIT_PROGRESS=auto
export DOCKER_DEFAULT_PLATFORM=linux/amd64

# Set Go proxy for consistent builds
export GOPROXY=direct
export GOSUMDB=off

echo "Docker BuildKit enabled for faster builds"
echo "Go proxy set to direct for consistent builds"

SERVICE_REPOS=("user" "product" "order" "rproxy")

REGION=$(aws ec2 describe-availability-zones --output text --query 'AvailabilityZones[0].[RegionName]')
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

REGISTRY="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
aws ecr get-login-password --region ${REGION} | docker login --username AWS --password-stdin $REGISTRY

deploy_service() {
    local SERVICE_NAME="$1"
    local VERSION="$2"

    if [[ -z "$SERVICE_NAME" ]]; then
        echo "Please provide a SERVICE NAME"
        exit 1
    fi

    local SERVICEECR="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/$SERVICE_NAME"

    echo "Building Go service: $SERVICE_NAME"
    echo "Build started at: $(date)"
    
    # Docker Image Build with cache enabled for speed
    echo "Building with BuildKit and cache enabled..."
    time DOCKER_BUILDKIT=1 docker build \
        --build-arg GOPROXY=direct \
        --build-arg GOSUMDB=off \
        --progress=auto \
        --platform=linux/amd64 \
        -t $SERVICEECR \
        -f Dockerfile.$SERVICE_NAME .
    
    echo "Build completed at: $(date)"
    
    # Docker Image Tag
    docker tag "$SERVICEECR" "$SERVICEECR:$VERSION"
    
    # Docker Image Push to ECR
    docker push "$SERVICEECR:$VERSION"

    echo '************************' 
    echo "AWS_REGION:" $REGION
    echo "$SERVICE_NAME SERVICE_ECR_REPO: $SERVICEECR VERSION: $VERSION"
}

CWD=$(pwd)
cd ../server/application-go

# Initialize Go modules and create vendor directory
echo "Initializing Go modules..."
go mod tidy
echo "Creating vendor directory..."
go mod vendor

for SERVICE in "${SERVICE_REPOS[@]}"; do
    echo -e "\033[0;33m==========\033[0;32m Repository [$SERVICE] checking... \033[0;33m==========\033[0m"
    REPO_EXISTS=$(aws ecr describe-repositories --repository-names "$SERVICE" --query 'repositories[0].repositoryUri' --output text 2>/dev/null || echo "NOT_FOUND")

    if [ "$REPO_EXISTS" == "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/$SERVICE" ]; then
        echo "Repository [$SERVICE] already exists."
    else
        echo "Repository [$SERVICE] does not exist, creating it..."
        aws ecr create-repository --repository-name "$SERVICE" | cat 
        echo "Repository [$SERVICE] created."
    fi

    deploy_service $SERVICE $VERSION_TAG
done

cd $CWD

echo "Go microservices build completed!"
echo "Image sizes comparison:"
echo "  NestJS: ~55MB per service"
echo "  Go:     ~8-15MB per service (70-85% smaller)"