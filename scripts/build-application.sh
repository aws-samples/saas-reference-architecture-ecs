#!/bin/bash
# build and push application services into ECR

# Download the official certificate for AWS RDS
download_RDS_ssl() {
    local SSL_CERT_PATH="../server/application/microservices/product_mysql/src/SSLCA.pem"
    echo -e "Downloading Amazon Root CA 1 certificate..."

    # 디렉토리 생성
    mkdir -p $(dirname "$SSL_CERT_PATH")

    # Amazon Root CA 1 인증서 다운로드
    curl -s -o "$SSL_CERT_PATH" https://www.amazontrust.com/repository/AmazonRootCA1.pem

    if [ $? -eq 0 ]; then
        chmod 644 "$SSL_CERT_PATH"
        echo "Amazon Root CA 1 certificate downloaded successfully to $SSL_CERT_PATH"
    else
        echo "Failed to download Amazon Root CA 1 certificate"
        exit 1
    fi
}


# Prompt user for DB_TYPE selection
select_db_type () {
    echo "Select the database type for 'product' service:"
    echo "1) DynamoDB"
    echo -n "2) MySQL: "
    echo -e "\033[38;5;172m\033[1m\033[4mScheme-per-tenant isolation in MySQL is only available for testing in Advanced Tier\033[0m"

    read -p "Enter the number corresponding to the database type [ default: 1) DynamoDB ]: " db_selection

    case $db_selection in
        2)
            DB_TYPE="mysql"
            download_RDS_ssl
            ;;
        *)
            DB_TYPE="dynamodb"
            ;;
    esac
    
    echo "export DB_TYPE=$DB_TYPE" > /tmp/db_type.env
    echo "Selected DB_TYPE: $DB_TYPE"
}

export DOCKER_DEFAULT_PLATFORM=linux/amd64

SERVICE_REPOS=("user" "product" "order" "rproxy")
# SERVICE_REPOS=("product")
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

    # Dabase handling for 'product' service  
    if [ "$SERVICE_NAME" == "product" ]; then
      echo "➤➤➤ Database App handling for $SERVICE_NAME"

      # Check environment variable or configuration to determine if MySQL or DynamoDB is used
      DB_TYPE=${DB_TYPE:-"dynamodb"}  # default to mysql if not set

      if [ "$DB_TYPE" == "mysql" ]; then
        echo "Building $SERVICE_NAME service for MySQL"
        cp -r ./microservices/product_mysql ./microservices/product
      elif [ "$DB_TYPE" == "dynamodb" ]; then
        echo "Building $SERVICE_NAME service for DynamoDB"
        cp -r ./microservices/product_dynamodb ./microservices/product
      else
        echo "Unknown DB_TYPE: $DB_TYPE. Exiting..."
        exit 1
      fi
    fi
    # Docker Image Build for other services
    docker build -t $SERVICEECR -f Dockerfile.$SERVICE_NAME .
    # Docker Image Tag
    docker tag "$SERVICEECR" "$SERVICEECR:$VERSION"
    # Docker Image Push to ECR
    docker push "$SERVICEECR:$VERSION"

    echo '************************' 
    echo "AWS_REGION:" $REGION
    echo "$SERVICE_NAME SERVICE_ECR_REPO: $SERVICEECR VERSION: $VERSION"
    rm -rf ./microservices/product || echo "Directory ./microservices/product does not exist."
}

# Call the select_db_type function for DB_TYPE selection
select_db_type

CWD=$(pwd)
cd ../server/application

for SERVICE in "${SERVICE_REPOS[@]}"; do
  echo -e "\033[0;33m==========\033[0;32m Repository [$SERVICE] checking... \033[0;33m==========\033[0m"
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