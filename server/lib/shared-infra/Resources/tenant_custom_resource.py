# Shared Custom Resource handler for tenant lifecycle operations.
# Replaces per-stack AwsCustomResource lambdas with a single shared lambda.
#
# Supported actions (via ResourceProperties.Action):
#   - DynamoPutItem: Insert tenant mapping into DynamoDB
#   - DynamoUpdateItem: Update tenant mapping in DynamoDB
#   - DynamoDeleteItem: Delete tenant mapping from DynamoDB
#   - LambdaInvoke: Invoke a Lambda function (e.g., MySQL schema provisioning)

import json
import boto3
import urllib.request

dynamodb = boto3.client('dynamodb')
lambda_client = boto3.client('lambda')


def handler(event, context):
    print(json.dumps(event))

    request_type = event['RequestType']  # Create, Update, Delete
    props = event['ResourceProperties']
    action = props.get('Action', '')

    try:
        if action == 'DynamoPutItem':
            handle_dynamo_put(request_type, props)
        elif action == 'LambdaInvoke':
            handle_lambda_invoke(request_type, props)
        else:
            print(f'Unknown action: {action}')

        send_response(event, context, 'SUCCESS')
    except Exception as e:
        print(f'Error: {str(e)}')
        send_response(event, context, 'FAILED', str(e))


def handle_dynamo_put(request_type, props):
    table_name = props['TableName']
    item = props.get('Item', {})
    key = props.get('Key', {})

    if request_type == 'Create':
        dynamodb.put_item(TableName=table_name, Item=item)
        print(f'DynamoDB PutItem success: {table_name}')

    elif request_type == 'Update':
        update_expr = props.get('UpdateExpression', '')
        expr_values = props.get('ExpressionAttributeValues', {})
        dynamodb.update_item(
            TableName=table_name,
            Key=key,
            UpdateExpression=update_expr,
            ExpressionAttributeValues=expr_values,
        )
        print(f'DynamoDB UpdateItem success: {table_name}')

    elif request_type == 'Delete':
        dynamodb.delete_item(TableName=table_name, Key=key)
        print(f'DynamoDB DeleteItem success: {table_name}')


def handle_lambda_invoke(request_type, props):
    if request_type != 'Create':
        print(f'LambdaInvoke skipped for {request_type}')
        return

    function_name = props['FunctionName']
    payload = props.get('Payload', '{}')

    lambda_client.invoke(
        FunctionName=function_name,
        InvocationType='Event',
        Payload=payload,
    )
    print(f'Lambda invoke success: {function_name}')


def send_response(event, context, status, reason=''):
    body = json.dumps({
        'Status': status,
        'Reason': reason or f'See CloudWatch Log Stream: {context.log_stream_name}',
        'PhysicalResourceId': event.get('PhysicalResourceId', context.log_stream_name),
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
    })

    req = urllib.request.Request(
        event['ResponseURL'],
        data=body.encode('utf-8'),
        headers={'Content-Type': ''},
        method='PUT',
    )
    urllib.request.urlopen(req)
