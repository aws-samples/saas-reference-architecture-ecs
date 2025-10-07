#!/bin/bash

set -e

# Get API Gateway URL
API_GATEWAY_URL=$(aws cloudformation describe-stacks \
  --stack-name shared-infra-stack \
  --query "Stacks[0].Outputs[?OutputKey=='ApiGatewayUrl'].OutputValue" \
  --output text 2>/dev/null)

if [[ -z "$API_GATEWAY_URL" ]]; then
  echo "❌ API Gateway URL not found"
  exit 1
fi

if [[ -z "$JWT_TOKEN" ]]; then
  echo "❌ JWT_TOKEN required: export JWT_TOKEN=\"your-token\""
  exit 1
fi

TOTAL_REQUESTS=${TOTAL_REQUESTS:-100}
CONCURRENT_LIMIT=${CONCURRENT_LIMIT:-50}

echo "🚀 Testing rate limiting with $TOTAL_REQUESTS requests (max $CONCURRENT_LIMIT concurrent)..."
echo "API: $API_GATEWAY_URL"

# Temp directory for result files
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Function to make a single request
make_request() {
  local request_id=$1
  local timestamp=$(date '+%H:%M:%S')
  
  local http_code=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 10 \
    -H "Authorization: Bearer $JWT_TOKEN" \
    -H "Cache-Control: no-cache" \
    "${API_GATEWAY_URL}products?_t=$(date +%s%N)&_id=$request_id" 2>/dev/null || echo "000")
  
  # Write result to file for aggregation
  echo "$http_code" > "$TEMP_DIR/result_$request_id"
  
  # Display real-time result
  case "$http_code" in
    200|201) 
      echo "[$timestamp] Request #$request_id: ✅ $http_code"
      ;;
    429) 
      echo "[$timestamp] Request #$request_id: 🚫 $http_code (Rate Limited)"
      ;;
    *) 
      echo "[$timestamp] Request #$request_id: ❌ $http_code (Error)"
      ;;
  esac
}

echo "📊 Sending requests (real-time results)..."
echo "" # Empty line for better readability
start_time=$(date +%s)

# Send requests with high concurrency for faster throughput
for ((i=1; i<=TOTAL_REQUESTS; i++)); do
  # Wait if we've reached concurrent limit
  while [ $(jobs -r | wc -l) -ge $CONCURRENT_LIMIT ]; do
    sleep 0.001  # Much shorter wait
  done
  
  # Start request in background
  make_request $i &
  
  # Minimal delay for ~50+ req/sec
  sleep 0.002
done

# Wait for all background jobs to complete
wait

end_time=$(date +%s)
duration=$((end_time - start_time))

# Count results from files
SUCCESS_COUNT=0
RATE_LIMITED_COUNT=0
ERROR_COUNT=0

for result_file in "$TEMP_DIR"/result_*; do
  if [[ -f "$result_file" ]]; then
    http_code=$(cat "$result_file")
    case "$http_code" in
      200|201) SUCCESS_COUNT=$((SUCCESS_COUNT + 1)) ;;
      429) RATE_LIMITED_COUNT=$((RATE_LIMITED_COUNT + 1)) ;;
      *) ERROR_COUNT=$((ERROR_COUNT + 1)) ;;
    esac
  fi
done

# Calculate requests per second
if [ $duration -gt 0 ]; then
  requests_per_second=$((TOTAL_REQUESTS / duration))
else
  requests_per_second=$TOTAL_REQUESTS
fi

echo ""
echo "📊 Results (${duration}s):"
echo "  📈 Requests/sec: $requests_per_second"
echo "  ✅ Success (200/201): $SUCCESS_COUNT"
echo "  🚫 Rate Limited (429): $RATE_LIMITED_COUNT"
echo "  ❌ Errors: $ERROR_COUNT"

if [ $RATE_LIMITED_COUNT -gt 0 ]; then
  echo ""
  echo "✅ Rate limiting is working!"
else
  echo ""
  echo "⚠️  No rate limiting detected"
fi