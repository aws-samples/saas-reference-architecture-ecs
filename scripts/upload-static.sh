#!/bin/bash
# =============================================================================
# Upload static assets (CSS/JS/images/fonts) to S3 for CloudFront CDN serving.
# Works with any JSP/SSR service — specify the service name and source path.
#
# Supports two source types:
#   - Directory: uploads contents directly (e.g. fossaadmin webapp/)
#   - WAR file:  extracts resources/ and webjars/ then uploads (e.g. petclinic)
#
# Prerequisites:
#   - AWS CLI configured
#   - shared-infra-stack deployed
#
# Usage:
#   ./scripts/upload-static.sh <service-name> <source-path> [--region ap-northeast-2] [--profile default]
#
# Examples:
#   # Directory source
#   ./scripts/upload-static.sh fossaadmin server/application/microservices/fossaadmin/src/main/webapp
#
#   # WAR file source (auto-extracts resources/ + webjars/)
#   ./scripts/upload-static.sh petclinic server/application/microservices/petclinic/target/petclinic.war
#
# After running:
#   Static assets accessible via CloudFront:
#   https://<cloudfront-domain>/<service-name>/resources/css/style.css
#   https://<cloudfront-domain>/<service-name>/webjars/jquery/2.2.4/jquery.min.js
# =============================================================================

set -e

# ---- Parse arguments ----
if [ $# -lt 2 ]; then
  echo "Usage: $0 <service-name> <source-path> [--region REGION] [--profile PROFILE]"
  echo ""
  echo "  source-path can be a directory or a .war file."
  echo ""
  echo "Examples:"
  echo "  $0 fossaadmin server/application/microservices/fossaadmin/src/main/webapp"
  echo "  $0 petclinic server/application/microservices/petclinic/target/petclinic.war"
  exit 1
fi

SERVICE_NAME="$1"
SOURCE_PATH="$2"
shift 2

REGION="ap-northeast-2"
PROFILE=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --region) REGION="$2"; shift 2 ;;
    --profile) PROFILE="--profile $2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

AWS_CMD="aws --region $REGION $PROFILE"
WAR_STAGING=""
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---- Resolve source: directory or WAR ----
if [[ "$SOURCE_PATH" == *.war ]]; then
  # WAR file — extract static resources into a temp staging directory
  # Resolve path relative to project root
  if [ ! -f "$SOURCE_PATH" ] && [ -f "$PROJECT_ROOT/$SOURCE_PATH" ]; then
    SOURCE_PATH="$PROJECT_ROOT/$SOURCE_PATH"
  fi
  if [ ! -f "$SOURCE_PATH" ]; then
    # Try to extract WAR from Docker build stage
    DOCKERFILE_NAME="Dockerfile.$SERVICE_NAME"
    DOCKERFILE_PATH="$PROJECT_ROOT/server/application/$DOCKERFILE_NAME"
    SOURCE_PATH_ABS="$PROJECT_ROOT/$SOURCE_PATH"

    if [ -f "$DOCKERFILE_PATH" ]; then
      echo "WAR not found locally. Building and extracting from Docker..."
      if docker build --target build -t "${SERVICE_NAME}-build-tmp" -f "$DOCKERFILE_PATH" "$PROJECT_ROOT/server/application"; then
        CONTAINER_ID=$(docker create "${SERVICE_NAME}-build-tmp")
        mkdir -p "$(dirname "$SOURCE_PATH_ABS")"
        docker cp "$CONTAINER_ID:/app/target/$(basename "$SOURCE_PATH")" "$SOURCE_PATH_ABS"
        docker rm "$CONTAINER_ID" > /dev/null 2>&1
        docker rmi "${SERVICE_NAME}-build-tmp" > /dev/null 2>&1 || true
        SOURCE_PATH="$SOURCE_PATH_ABS"
      else
        echo "ERROR: Docker build failed. Check Dockerfile and network connectivity."
        exit 1
      fi
    else
      echo "ERROR: Dockerfile not found at $DOCKERFILE_PATH"
    fi

    if [ ! -f "$SOURCE_PATH" ]; then
      echo "ERROR: WAR file not found: $SOURCE_PATH"
      echo "       Build the project first (e.g. mvn package -DskipTests)"
      exit 1
    fi
  fi

  WAR_STAGING="/tmp/upload-static-war-staging-$$"
  rm -rf "$WAR_STAGING"
  mkdir -p "$WAR_STAGING"

  echo "Extracting static resources from WAR: $SOURCE_PATH"

  # Extract resources/ (compiled CSS, images, fonts, etc.)
  unzip -q -o "$SOURCE_PATH" "resources/*" -d "$WAR_STAGING" 2>/dev/null || true

  # Extract webjars from JAR files inside WAR
  WEBJARS_TMP="/tmp/upload-static-webjars-$$"
  rm -rf "$WEBJARS_TMP"
  mkdir -p "$WEBJARS_TMP"

  # Extract all webjar JARs from WEB-INF/lib/
  unzip -q -o "$SOURCE_PATH" "WEB-INF/lib/jquery-*.jar" "WEB-INF/lib/bootstrap-*.jar" \
    -d "$WEBJARS_TMP" 2>/dev/null || true

  # Extract static files from each JAR
  for JAR in "$WEBJARS_TMP"/WEB-INF/lib/*.jar; do
    if [ -f "$JAR" ]; then
      echo "  Extracting webjars from: $(basename "$JAR")"
      unzip -q -o "$JAR" "META-INF/resources/webjars/*" -d "$WEBJARS_TMP" 2>/dev/null || true
    fi
  done

  # Move webjars into staging
  if [ -d "$WEBJARS_TMP/META-INF/resources/webjars" ]; then
    mkdir -p "$WAR_STAGING/webjars"
    cp -r "$WEBJARS_TMP/META-INF/resources/webjars/"* "$WAR_STAGING/webjars/"
  fi
  rm -rf "$WEBJARS_TMP"

  STATIC_BASE="$WAR_STAGING"
  echo "  Staging directory: $STATIC_BASE"
else
  # Directory source — resolve relative to project root
  RESOLVED_PATH="$SOURCE_PATH"
  if [ ! -d "$RESOLVED_PATH" ]; then
    RESOLVED_PATH="$PROJECT_ROOT/$SOURCE_PATH"
  fi
  if [ ! -d "$RESOLVED_PATH" ]; then
    echo "ERROR: Static asset directory not found: $SOURCE_PATH"
    echo "       Run this script from the project root."
    exit 1
  fi
  STATIC_BASE="$RESOLVED_PATH"
fi

echo "======================================================"
echo " Upload static assets to S3 for: $SERVICE_NAME"
echo " Source: $STATIC_BASE"
echo " Region: $REGION"
echo "======================================================"

# ---- Read appSiteUrl from CloudFormation ----
echo ""
echo "[1/3] Fetching appSiteUrl from CloudFormation..."

APP_SITE_URL=$($AWS_CMD cloudformation describe-stacks \
  --stack-name shared-infra-stack \
  --query "Stacks[0].Outputs[?OutputKey=='appSiteUrl'].OutputValue" \
  --output text)

if [ -z "$APP_SITE_URL" ] || [ "$APP_SITE_URL" == "None" ]; then
  echo "ERROR: appSiteUrl output not found in shared-infra-stack."
  exit 1
fi

CLOUDFRONT_DOMAIN=$(echo "$APP_SITE_URL" | sed 's|https://||')
echo "  CloudFront URL: $APP_SITE_URL"

# ---- Resolve S3 bucket name ----
echo ""
echo "[2/3] Resolving S3 bucket name..."

ACCOUNT=$($AWS_CMD sts get-caller-identity --query Account --output text)
S3_BUCKET="appsitebucket-${ACCOUNT}-${REGION}"
echo "  S3 Bucket: $S3_BUCKET"

if ! $AWS_CMD s3 ls "s3://$S3_BUCKET" > /dev/null 2>&1; then
  echo "ERROR: S3 bucket '$S3_BUCKET' not found."
  exit 1
fi

# ---- Upload to S3 ----
echo ""
echo "[3/3] Uploading to S3... (s3://$S3_BUCKET/$SERVICE_NAME/)"

# Content-type aware upload to prevent ERR_BLOCKED_BY_ORB in browsers
CONTENT_TYPES=(
  "*.css:text/css"
  "*.js:application/javascript"
  "*.png:image/png"
  "*.jpg:image/jpeg"
  "*.jpeg:image/jpeg"
  "*.gif:image/gif"
  "*.svg:image/svg+xml"
  "*.woff:font/woff"
  "*.woff2:font/woff2"
  "*.ttf:font/ttf"
  "*.eot:application/vnd.ms-fontobject"
  "*.ico:image/x-icon"
  "*.json:application/json"
  "*.map:application/json"
)

for entry in "${CONTENT_TYPES[@]}"; do
  PATTERN="${entry%%:*}"
  CTYPE="${entry##*:}"
  $AWS_CMD s3 sync "$STATIC_BASE" "s3://$S3_BUCKET/$SERVICE_NAME/" \
    --cache-control "max-age=86400" \
    --metadata-directive REPLACE \
    --exclude "*" --include "$PATTERN" \
    --content-type "$CTYPE" \
    --quiet 2>/dev/null || true
done

# ---- Cleanup WAR staging if used ----
if [ -n "$WAR_STAGING" ]; then
  rm -rf "$WAR_STAGING"
fi

# ---- Print result ----
echo ""
echo "======================================================"
echo " Upload complete: $SERVICE_NAME"
echo "======================================================"
echo ""
echo " CDN URL: https://$CLOUDFRONT_DOMAIN/$SERVICE_NAME/"
echo ""
echo " Set CDN_URL environment variable in service-info*.txt:"
echo "   \"CDN_URL\": \"https://$CLOUDFRONT_DOMAIN/$SERVICE_NAME\""
echo ""
