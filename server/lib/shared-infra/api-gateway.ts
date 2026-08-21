
import * as lambda_python from '@aws-cdk/aws-lambda-python-alpha';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { type CustomApiKey } from '../interfaces/custom-api-key';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';
import * as fs from 'fs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { type ITable } from 'aws-cdk-lib/aws-dynamodb';


interface ApiGatewayProps {
  lambdaEcsSaaSLayers: lambda.LayerVersion
  tenantRegistryTable: ITable
  stageName: string
  vpcLinkId: string
  albArn: string
  albDnsName: string
  apiKeyBasicTier: CustomApiKey
  apiKeyAdvancedTier: CustomApiKey
  apiKeyPremiumTier: CustomApiKey
}

export class ApiGateway extends Construct {
  public readonly restApi: apigateway.SpecRestApi;
  public readonly requestValidator: apigateway.RequestValidator;
  constructor(scope: Construct, id: string, props: ApiGatewayProps) {
    super(scope, id);

    const basicAuthorizerExecutionRole = new cdk.aws_iam.PolicyDocument({
      statements: [
        new cdk.aws_iam.PolicyStatement({
          actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: ['*']
        }),
        new cdk.aws_iam.PolicyStatement({
          actions: ['apigateway:GET'],
          resources: [
            props.apiKeyBasicTier.apiKeyId,
            props.apiKeyAdvancedTier.apiKeyId,
            props.apiKeyPremiumTier.apiKeyId
          ].map((apiKeyId) =>
            `arn:${cdk.Aws.PARTITION}:apigateway:${cdk.Stack.of(this).region}::/apikeys/${apiKeyId}`
          )
        }),
        new cdk.aws_iam.PolicyStatement({
          actions: ['dynamodb:GetItem'],
          resources: [props.tenantRegistryTable.tableArn]
        }),
        new cdk.aws_iam.PolicyStatement({
          actions: [
            'cognito-idp:DescribeUserPool',
            'cognito-idp:DescribeUserPoolClient'
          ],
          resources: [
            `arn:${cdk.Aws.PARTITION}:cognito-idp:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:userpool/*`
          ],
          conditions: {
            StringEquals: {
              'aws:ResourceTag/SaaSFactory': 'ECS-SaaS-Ref'
            }
          }
        })
      ]
    });

    const authorizerFunction = new lambda_python.PythonFunction(this, 'AuthorizerFunction', {
      entry: path.join(__dirname, './Resources'),
      handler: 'lambda_handler',
      index: 'tenant_authorizer.py',
      runtime: lambda.Runtime.PYTHON_3_10,
      tracing: lambda.Tracing.ACTIVE,
      layers: [props.lambdaEcsSaaSLayers],
      role: new cdk.aws_iam.Role(this, 'AuthorizerFunctionRole', {
        assumedBy: new cdk.aws_iam.ServicePrincipal('lambda.amazonaws.com'),
        inlinePolicies: { BasicAuthorizerExecutionRole: basicAuthorizerExecutionRole }
      }),
      environment: {
        TRUSTED_TENANT_REGISTRY_TABLE: props.tenantRegistryTable.tableName,
        IDP_DETAILS: JSON.stringify({
          name: 'Cognito',
          trustedPoolTag: {
            key: 'SaaSFactory',
            value: 'ECS-SaaS-Ref'
          }
        }),
        ...{
          PREMIUM_TIER_API_KEY: props.apiKeyPremiumTier.value,
          ADVANCED_TIER_API_KEY: props.apiKeyAdvancedTier.value,
          BASIC_TIER_API_KEY: props.apiKeyBasicTier.value
        }
      }
    });
    const logGroup = new LogGroup(this, 'PrdLogs');

    // Swagger/OpenAPI file path
    const swaggerFilePath = path.join(__dirname, '../tenant-api-prod.json');
    let swaggerContent = fs.readFileSync(swaggerFilePath, 'utf-8');

    const replacements: { [key: string]: string } = {
      '{{version}}': '1.0.0',
      '{{API_TITLE}}': 'EcsTenantAPI',
      '{{stage}}': props.stageName,
      '{{connection_id}}': props.vpcLinkId,
      '{{integration_uri}}': `http://${props.albDnsName}`,
      '{{integration_target}}': props.albArn,
      '{{region}}': cdk.Stack.of(this).region,
      '{{account_id}}': cdk.Stack.of(this).account,
      '{{authorizer_function}}': authorizerFunction.functionName
    }

    let updateData = swaggerContent;
    for(const [placeholder, replacement] of Object.entries(replacements)) {
      const regex = new RegExp(placeholder, 'g');
      updateData = updateData.replace(regex, replacement);
    }
    // console.log('updateData: ' + updateData);
    
    // API Gateway Rest API creation
    this.restApi = new apigateway.SpecRestApi(this, 'TenantApi', {
      restApiName: 'TenantAPI',
      description: 'API imported from a Swagger/OpenAPI definition with placeholders replaced',
      apiDefinition: apigateway.ApiDefinition.fromInline(JSON.parse(updateData)),
      cloudWatchRole: true,
      deployOptions: {
        accessLogDestination: new apigateway.LogGroupLogDestination(logGroup),
        methodOptions: {
          '/*/*': {
            dataTraceEnabled: false,
            loggingLevel: apigateway.MethodLoggingLevel.ERROR,
          },
        },
        stageName: props.stageName,
      },
    });

    // Set API Key Source Type using L1 construct
    const cfnRestApi = this.restApi.node.defaultChild as apigateway.CfnRestApi;
    cfnRestApi.apiKeySourceType = 'AUTHORIZER';

    authorizerFunction.addPermission('AuthorizerPermission', {
      principal: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:${this.restApi.restApiId}/authorizers/*`
    });
  }
}
