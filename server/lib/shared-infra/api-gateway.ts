import * as cdk from 'aws-cdk-lib';
import * as lambda_python from '@aws-cdk/aws-lambda-python-alpha';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';
import type * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { UsagePlans } from './usage-plans';
import { type CustomApiKey } from '../interfaces/custom-api-key';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import { addTemplateTag } from '../utilities/helper-functions';

interface ApiGatewayProps {
  lambdaEcsSaaSLayers: lambda.LayerVersion
  tenantId: string
  isPooledDeploy: boolean
  stageName: string
  nlb: elbv2.NetworkLoadBalancer
  apiKeyBasicTier: CustomApiKey
  apiKeyAdvancedTier: CustomApiKey
  apiKeyPremiumTier: CustomApiKey
  apiKeyPlatinumTier: CustomApiKey
}

export class ApiGateway extends Construct {
  public readonly restApi: apigateway.RestApi;
  public readonly tenantScopedAccessRole: cdk.aws_iam.Role;
  public readonly requestValidator: apigateway.RequestValidator;
  constructor (scope: Construct, id: string, props: ApiGatewayProps) {
    super(scope, id);
    addTemplateTag(this, 'ApiGateway');
    // 👇Create ACM Permission Policy
    const basicAuthorizerExecutionRole = new cdk.aws_iam.PolicyDocument({
      statements: [
        new cdk.aws_iam.PolicyStatement({
          actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: ['*']
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
      // role setting
      role: new cdk.aws_iam.Role(this, 'AuthorizerFunctionRole', {
        assumedBy: new cdk.aws_iam.ServicePrincipal('lambda.amazonaws.com'),
        inlinePolicies: { BasicAuthorizerExecutionRole: basicAuthorizerExecutionRole }
      }),
      environment: {
        IDP_DETAILS: JSON.stringify({
          name: 'Cognito'
        }),
        ...{
          PLATINUM_TIER_API_KEY: props.apiKeyPlatinumTier.value,
          PREMIUM_TIER_API_KEY: props.apiKeyPremiumTier.value,
          ADVANCED_TIER_API_KEY: props.apiKeyAdvancedTier.value,
          BASIC_TIER_API_KEY: props.apiKeyBasicTier.value
        }
      }
    });

    if (!authorizerFunction.role?.roleArn) {
      throw new Error('AuthorizerFunction roleArn is undefined');
    }
    this.tenantScopedAccessRole = new cdk.aws_iam.Role(this, 'AuthorizerAccessRole', {
      assumedBy: new cdk.aws_iam.ArnPrincipal(authorizerFunction.role?.roleArn)
    });
    authorizerFunction.addEnvironment(
      'AUTHORIZER_ACCESS_ROLE',
      this.tenantScopedAccessRole.roleArn
    );

    const logGroup = new LogGroup(this, 'PrdLogs');

    this.restApi = new apigateway.RestApi(this, `TenantAPI-${props.stageName}`, {
      apiKeySourceType: apigateway.ApiKeySourceType.AUTHORIZER,
      defaultMethodOptions: {
        apiKeyRequired: true,
        authorizationType: apigateway.AuthorizationType.CUSTOM,
        authorizer: new apigateway.TokenAuthorizer(this, 'TenantAPIAuthorizer', {
          handler: authorizerFunction,
          identitySource: apigateway.IdentitySource.header('Authorization'),
          resultsCacheTtl: Duration.seconds(30)
        })
      },
      cloudWatchRole: true,
      deployOptions: {
        accessLogDestination: new apigateway.LogGroupLogDestination(logGroup),
        methodOptions: {
          '/*/*': {
            dataTraceEnabled: true,
            loggingLevel: apigateway.MethodLoggingLevel.ERROR
          }
        }
      },
      defaultCorsPreflightOptions: {
        allowOrigins: ['*'],
        allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token'
        ]
      }
    });

    this.requestValidator = this.restApi.addRequestValidator('RequestValidator', {
      requestValidatorName: 'ecsRequestValidator',
      validateRequestBody: false,
      validateRequestParameters: false
    });

    new UsagePlans(this, 'UsagePlans', {
      apiGateway: this.restApi,
      apiKeyIdBasicTier: props.apiKeyBasicTier.apiKeyId,
      apiKeyIdAdvancedTier: props.apiKeyAdvancedTier.apiKeyId,
      apiKeyIdPremiumTier: props.apiKeyPremiumTier.apiKeyId,
      apiKeyIdPlatinumTier: props.apiKeyPlatinumTier.apiKeyId,
      isPooledDeploy: props.isPooledDeploy
    });
  }
}
