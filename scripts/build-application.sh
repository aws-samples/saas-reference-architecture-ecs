#!/bin/bash
# build and push application services into ECR

# Download the official certificate for AWS RDS
download_RDS_ssl() {
    local SSL_CERT_PATH="../server/application/microservices/product_mysql/src/SSLCA.pem"
    echo -e "Downloading Amazon Root CA 1 certificate..."

    mkdir -p $(dirname "$SSL_CERT_PATH")

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
    echo "Select the database type (determines Product service source and RDS provisioning):"
    echo "1) DynamoDB"
    echo -n "2) MySQL: "
    echo -e "\033[38;5;172m\033[1m\033[4mSchema-per-tenant isolation in MySQL (selects Product service source only)\033[0m"
    echo -n "3) PostgreSQL: "
    echo -e "\033[38;5;172m\033[1m\033[4mSchema-per-tenant isolation in PostgreSQL (selects Product service source only)\033[0m"

    read -p "Enter the number corresponding to the database type [ default: 1) DynamoDB ]: " db_selection

    case $db_selection in
        2)
            DB_TYPE="mysql"
            download_RDS_ssl
            ;;
        3)
            DB_TYPE="postgresql"
            ;;
        *)
            DB_TYPE="dynamodb"
            ;;
    esac

    echo "export DB_TYPE=$DB_TYPE" > /tmp/db_type.env
    echo "Selected DB_TYPE: $DB_TYPE"
}

# Always build x86_64 (AMD64) images for ECS
# Works natively on x86_64 hosts, uses Rosetta/QEMU on Apple Silicon
export DOCKER_DEFAULT_PLATFORM=linux/amd64
echo "Building AMD64 images for x86_64 ECS (host: $(uname -m))"

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

    # Database handling for 'product' service
    if [ "$SERVICE_NAME" == "product" ]; then
      echo "➤➤➤ Database App handling for $SERVICE_NAME"

      DB_TYPE=${DB_TYPE:-"dynamodb"}

      if [ "$DB_TYPE" == "mysql" ]; then
        echo "Building $SERVICE_NAME service for MySQL"
        cp -r ./microservices/product_mysql ./microservices/product
      elif [ "$DB_TYPE" == "postgresql" ]; then
        echo "Building $SERVICE_NAME service for PostgreSQL"
        cp -r ./microservices/product_postgresql ./microservices/product
      elif [ "$DB_TYPE" == "dynamodb" ]; then
        echo "Building $SERVICE_NAME service for DynamoDB"
        cp -r ./microservices/product_dynamodb ./microservices/product
      else
        echo "Unknown DB_TYPE: $DB_TYPE. Exiting..."
        exit 1
      fi
    fi

    # Docker Image Build
    # Go services use cross-compilation — build without platform override to avoid QEMU issues on Apple Silicon
    if [ -f "Dockerfile.$SERVICE_NAME" ] && grep -q "GOARCH=amd64" "Dockerfile.$SERVICE_NAME" 2>/dev/null; then
      echo "Go cross-compile detected, building without platform override"
      DOCKER_DEFAULT_PLATFORM= docker build -t $SERVICEECR -f Dockerfile.$SERVICE_NAME .
    else
      # Java: build JAR locally if pom.xml exists (avoids QEMU slowness on Apple Silicon)
      [ -f "microservices/$SERVICE_NAME/pom.xml" ] && \
        (cd microservices/$SERVICE_NAME && JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home} mvn clean package -DskipTests -q) && echo "JAR build complete"
      docker build -t $SERVICEECR -f Dockerfile.$SERVICE_NAME .
    fi
    # Docker Image Tag
    docker tag "$SERVICEECR" "$SERVICEECR:$VERSION"
    # Docker Image Push to ECR
    docker push "$SERVICEECR:$VERSION"

    echo '************************' 
    echo "AWS_REGION:" $REGION
    echo "$SERVICE_NAME SERVICE_ECR_REPO: $SERVICEECR VERSION: $VERSION"

    # Cleanup temporary product directory
    if [ "$SERVICE_NAME" == "product" ]; then
      rm -rf ./microservices/product || echo "Directory ./microservices/product does not exist."
    fi
}

# Call the select_db_type function for DB_TYPE selection
select_db_type

CWD=$(pwd)

# Generate service-info.json from service-info.txt (supports // JSONC comments)
cd ../server
sed 's|//.*||' "./service-info.txt" | sed "s/<REGION>/$REGION/g; s/<ACCOUNT_ID>/$ACCOUNT_ID/g" > ./lib/service-info.json
echo "Generated service-info.json (DB_TYPE=$DB_TYPE)"

# Extract service names from service-info.json (single source of truth)
SERVICE_REPOS=($(node -e "
  const info = JSON.parse(require('fs').readFileSync('./lib/service-info.json', 'utf8'));
  const names = info.Containers.map(c => c.name === 'orders' ? 'order' : c.name === 'products' ? 'product' : c.name === 'users' ? 'user' : c.name);
  names.push(info.Rproxy.name);
  console.log(names.join(' '));
"))
echo "Services to build: ${SERVICE_REPOS[@]}"

cd application

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
