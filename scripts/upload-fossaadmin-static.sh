#!/bin/bash
# =============================================================================
# Modifications for NTELS Fossa service integration
#
# Upload fossaadmin static assets (css/js/img/webfont) to the S3 bucket
# used by the Application CloudFront distribution.
# Files are served directly via CDN without going through API Gateway.
#
# Prerequisites:
#   - AWS CLI configured
#   - shared-infra-stack deployed
#
# Usage:
#   ./scripts/upload-fossaadmin-static.sh [--region ap-northeast-2] [--profile default]
#
# After running:
#   Static assets accessible via CloudFront:
#   https://<cloudfront-domain>/fossaadmin/css/amb_import.css
#   https://<cloudfront-domain>/fossaadmin/js/plugins/jquery-3.1.1.min.js
# =============================================================================

set -e

# ---- Parse arguments ----
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

echo "======================================================"
echo " Upload fossaadmin static assets to S3"
echo " Region: $REGION"
echo "======================================================"

# ---- Read appSiteUrl from CloudFormation ----
echo ""
echo "[1/4] Fetching appSiteUrl from CloudFormation..."

APP_SITE_URL=$($AWS_CMD cloudformation describe-stacks \
  --stack-name shared-infra-stack \
  --query "Stacks[0].Outputs[?OutputKey=='appSiteUrl'].OutputValue" \
  --output text)

if [ -z "$APP_SITE_URL" ] || [ "$APP_SITE_URL" == "None" ]; then
  echo "ERROR: appSiteUrl output not found in shared-infra-stack."
  echo "       Make sure shared-infra-stack is deployed."
  exit 1
fi

# Strip https:// to get bare domain
CLOUDFRONT_DOMAIN=$(echo "$APP_SITE_URL" | sed 's|https://||')
echo "  CloudFront URL: $APP_SITE_URL"
echo "  CloudFront Domain: $CLOUDFRONT_DOMAIN"

# ---- Resolve S3 bucket name ----
echo ""
echo "[2/4] Resolving S3 bucket name..."

ACCOUNT=$($AWS_CMD sts get-caller-identity --query Account --output text)
S3_BUCKET="appsitebucket-${ACCOUNT}-${REGION}"
echo "  S3 Bucket: $S3_BUCKET"

# Verify bucket exists
if ! $AWS_CMD s3 ls "s3://$S3_BUCKET" > /dev/null 2>&1; then
  echo "ERROR: S3 bucket '$S3_BUCKET' not found."
  exit 1
fi

# ---- Verify static asset source path ----
STATIC_BASE="server/application/microservices/fossaadmin/src/main/webapp"

if [ ! -d "$STATIC_BASE" ]; then
  echo "ERROR: fossaadmin webapp directory not found: $STATIC_BASE"
  echo "       Run this script from the project root."
  exit 1
fi

# ---- Upload to S3 ----
echo ""
echo "[3/4] Uploading to S3... (s3://$S3_BUCKET/fossaadmin/)"

upload_dir() {
  local src="$1"
  local dest="$2"
  if [ -d "$src" ]; then
    echo "  Uploading $src -> s3://$S3_BUCKET/$dest"

    # Upload by content-type to prevent ERR_BLOCKED_BY_ORB in browsers.
    # S3 auto-detection can fail and serve files as application/octet-stream,
    # which causes browsers to block cross-origin responses for CSS/JS.
    $AWS_CMD s3 sync "$src" "s3://$S3_BUCKET/$dest" \
      --delete \
      --cache-control "max-age=86400" \
      --metadata-directive REPLACE \
      --exclude "*" --include "*.css" \
      --content-type "text/css"

    $AWS_CMD s3 sync "$src" "s3://$S3_BUCKET/$dest" \
      --cache-control "max-age=86400" \
      --metadata-directive REPLACE \
      --exclude "*" --include "*.js" \
      --content-type "application/javascript"

    $AWS_CMD s3 sync "$src" "s3://$S3_BUCKET/$dest" \
      --cache-control "max-age=86400" \
      --metadata-directive REPLACE \
      --exclude "*" --include "*.png" \
      --content-type "image/png"

    $AWS_CMD s3 sync "$src" "s3://$S3_BUCKET/$dest" \
      --cache-control "max-age=86400" \
      --metadata-directive REPLACE \
      --exclude "*" --include "*.jpg" --include "*.jpeg" \
      --content-type "image/jpeg"

    $AWS_CMD s3 sync "$src" "s3://$S3_BUCKET/$dest" \
      --cache-control "max-age=86400" \
      --metadata-directive REPLACE \
      --exclude "*" --include "*.gif" \
      --content-type "image/gif"

    $AWS_CMD s3 sync "$src" "s3://$S3_BUCKET/$dest" \
      --cache-control "max-age=86400" \
      --metadata-directive REPLACE \
      --exclude "*" --include "*.svg" \
      --content-type "image/svg+xml"

    $AWS_CMD s3 sync "$src" "s3://$S3_BUCKET/$dest" \
      --cache-control "max-age=86400" \
      --metadata-directive REPLACE \
      --exclude "*" --include "*.woff" \
      --content-type "font/woff"

    $AWS_CMD s3 sync "$src" "s3://$S3_BUCKET/$dest" \
      --cache-control "max-age=86400" \
      --metadata-directive REPLACE \
      --exclude "*" --include "*.woff2" \
      --content-type "font/woff2"

    $AWS_CMD s3 sync "$src" "s3://$S3_BUCKET/$dest" \
      --cache-control "max-age=86400" \
      --metadata-directive REPLACE \
      --exclude "*" --include "*.ttf" \
      --content-type "font/ttf"

    $AWS_CMD s3 sync "$src" "s3://$S3_BUCKET/$dest" \
      --cache-control "max-age=86400" \
      --metadata-directive REPLACE \
      --exclude "*" --include "*.ico" \
      --content-type "image/x-icon"
  else
    echo "  SKIP: $src (directory not found)"
  fi
}

upload_dir "$STATIC_BASE/css"     "fossaadmin/css"
upload_dir "$STATIC_BASE/js"      "fossaadmin/js"
upload_dir "$STATIC_BASE/img"     "fossaadmin/img"
upload_dir "$STATIC_BASE/webfont" "fossaadmin/webfont"

# ---- Print result ----
echo ""
echo "[4/4] Done"
echo ""
echo "======================================================"
echo " Upload complete"
echo "======================================================"
echo ""
echo " CloudFront static asset URL examples:"
echo "   https://$CLOUDFRONT_DOMAIN/fossaadmin/css/amb_import.css"
echo "   https://$CLOUDFRONT_DOMAIN/fossaadmin/js/plugins/jquery-3.1.1.min.js"
echo "   https://$CLOUDFRONT_DOMAIN/fossaadmin/img/main_logo.png"
echo ""
echo " Set this value as FOSSAADMIN_STATIC_URL in fossaadmin environment:"
echo "   FOSSAADMIN_STATIC_URL=https://$CLOUDFRONT_DOMAIN/fossaadmin"
echo ""
