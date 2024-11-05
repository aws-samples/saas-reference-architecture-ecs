import os
import json
import requests

ALB_ENDPOINT=os.environ['ALB_ENDPOINT']

def lambda_handler(event, context):
    # Check event from WebSocket API Gateway 
    print(event)
    # connection_id = event['requestContext']['connectionId']
    body = event['body']
    # print(body)

    tenantPath = event['queryStringParameters']['tenantPath']
    print(tenantPath)

    headers = {
        'Content-Type': 'application/json',
        # 'X-API-Key': body.get('x-api-key', 'default-api-key'),
        'tenantPath': tenantPath
    }

    # send a request to ALB
    response = requests.post(ALB_ENDPOINT, headers=headers, json=body)

    # handle response from ALB
    return {
        'statusCode': response.status_code,
        'body': json.dumps(response.text)
    }