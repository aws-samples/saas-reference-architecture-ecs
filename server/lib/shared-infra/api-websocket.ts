
import * as lambda_python from '@aws-cdk/aws-lambda-python-alpha';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { type CustomApiKey } from '../interfaces/custom-api-key';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';
import type * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { CfnApi, CfnAuthorizer, 
  CfnIntegration, CfnIntegrationResponse, 
  CfnRoute, CfnRouteResponse, CfnStage } from 'aws-cdk-lib/aws-apigatewayv2';

interface ApiWebSocketProps {
  lambdaEcsSaaSLayers: lambda.LayerVersion
  stageName: string
  alb: elbv2.IApplicationLoadBalancer
  sg: cdk.aws_ec2.ISecurityGroup
  apiKeyBasicTier: CustomApiKey
  apiKeyAdvancedTier: CustomApiKey
  apiKeyPremiumTier: CustomApiKey
}

export class ApiWebSocket extends Construct {
  public readonly restApi: apigateway.SpecRestApi;
  public readonly tenantScopedAccessRole: cdk.aws_iam.Role;
  public readonly requestValidator: apigateway.RequestValidator;
  constructor(scope: Construct, id: string, props: ApiWebSocketProps) {
    super(scope, id);

    const basicAuthorizerExecutionRole = new cdk.aws_iam.PolicyDocument({
      statements: [
        new cdk.aws_iam.PolicyStatement({
          actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: ['*']
        })
      ]
    });

    const wsAuthorizerFunction = new lambda_python.PythonFunction(this, 'WebSocketAuthorizerFunction', {
      functionName: 'websocket-authorizer',
      entry: path.join(__dirname, './authorizer-websocket'),
      handler: 'lambda_handler',
      index: 'websocket_authorizer.py',
      runtime: lambda.Runtime.PYTHON_3_10,
      tracing: lambda.Tracing.ACTIVE,
      layers: [props.lambdaEcsSaaSLayers],
      // role setting
      role: new cdk.aws_iam.Role(this, 'WSAuthorizerFunctionRole', {
        assumedBy: new cdk.aws_iam.ServicePrincipal('lambda.amazonaws.com'),
        inlinePolicies: { BasicAuthorizerExecutionRole: basicAuthorizerExecutionRole }
      }),
      environment: {
        IDP_DETAILS: JSON.stringify({
          name: 'Cognito'
        }),
        ...{
          PREMIUM_TIER_API_KEY: props.apiKeyPremiumTier.value,
          ADVANCED_TIER_API_KEY: props.apiKeyAdvancedTier.value,
          BASIC_TIER_API_KEY: props.apiKeyBasicTier.value
        }
      }
    });
    if (!wsAuthorizerFunction.role?.roleArn) {
      throw new Error('AuthorizerFunction roleArn is undefined');
    }
    const AuthorizerAccessRole = new cdk.aws_iam.Role(this, 'wsAuthorizerAccessRole', {
      assumedBy: new cdk.aws_iam.ArnPrincipal(wsAuthorizerFunction.role?.roleArn)
    });
    wsAuthorizerFunction.addEnvironment(
      'AUTHORIZER_ACCESS_ROLE',
      AuthorizerAccessRole.roleArn
    );
    
    const wsProxyFunction = new lambda_python.PythonFunction(this, 'WebSocketProxyFunction', {
      functionName: 'websocket-proxy',
      entry: path.join(__dirname, './websocket-proxy'),
      handler: 'lambda_handler',
      index: 'websocket_proxy.py',
      runtime: lambda.Runtime.PYTHON_3_10,
      tracing: lambda.Tracing.ACTIVE,
      layers: [props.lambdaEcsSaaSLayers],
      // role setting
      role: new cdk.aws_iam.Role(this, 'wsProxyFunctionRole', {
        assumedBy: new cdk.aws_iam.ServicePrincipal('lambda.amazonaws.com'),
        inlinePolicies: { BasicAuthorizerExecutionRole: basicAuthorizerExecutionRole },
        managedPolicies : [
          cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName(`service-role/AWSLambdaVPCAccessExecutionRole`),
        ]
      }),
      environment: {
        ALB_ENDPOINT: `http://${props.alb.loadBalancerDnsName}/websocket`
      },
      vpc: props.alb.vpc,
      vpcSubnets: { subnets: props.alb.vpc?.privateSubnets },
      securityGroups: [props.sg]

    });
    if (!wsProxyFunction.role?.roleArn) {
      throw new Error('wsProxyFunction roleArn is undefined');
    }
    const wsProxyAccessRole = new cdk.aws_iam.Role(this, 'wsProxyAccessRole', {
      assumedBy: new cdk.aws_iam.ArnPrincipal(wsProxyFunction.role?.roleArn)
    });
    wsProxyFunction.addEnvironment(
      'AUTHORIZER_ACCESS_ROLE',
      wsProxyAccessRole.roleArn
    );

    // const requestTemplate = {
    //   "tenantPath": "$inputJson.tenantPath",
    //                             "action": "$inputJson.action",
    //                             "message": "$inputJson.message",
    //                             "connectionId": "$context.connectionId",
    //                             "routeKey": "$context.routeKey"
    // }

    const websocketApi = new CfnApi(this, 'WebSocketApi', {
      name: 'WebSocketApi',
      protocolType: 'WEBSOCKET',
      routeSelectionExpression: '$request.body.action',
      
    });

    const authorizer = new CfnAuthorizer(this, 'WebSocketAuthorizer', {
      apiId: websocketApi.ref,
      authorizerType: 'REQUEST',
      name: 'WebSocketLambdaAuthorizer',
      authorizerUri: `arn:aws:apigateway:${cdk.Stack.of(this).region}:lambda:path/2015-03-31/functions/${wsAuthorizerFunction.functionArn}/invocations`,
      identitySource: ['route.request.header.Authorization'], // Specify where to look for auth tokens
    });    

    const integration = new CfnIntegration(this, 'WebSocketIntegration', {
      apiId: websocketApi.ref,
      integrationType: 'AWS',
      integrationUri: `arn:aws:apigateway:${cdk.Stack.of(this).region}:lambda:path/2015-03-31/functions/${wsProxyFunction.functionArn}/invocations`,
      templateSelectionExpression: '\\$default',
      requestTemplates: {
            '$default': 
            `#set($tenantPath = $context.authorizer.tenantPath)
            {
                "body": $input.json("$"),
                "headers": {
                  "tenantPath": $input.json("$.tenantPath")
                },
                "queryStringParameters": {
                  "tenantPath": $input.json("$.tenantPath")
                }
            }`
      },
      
    });

    const lambdaPermission = new lambda.CfnPermission(this, 'WebSocketLambdaInvokePermission', {
      action: 'lambda:InvokeFunction',
      functionName: wsAuthorizerFunction.functionName,
      principal: 'apigateway.amazonaws.com',
      sourceArn: `arn:aws:execute-api:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:${websocketApi.ref}/*`,
    });

    const webSocketConnectionPolicy = new cdk.aws_iam.PolicyStatement({
      effect: cdk.aws_iam.Effect.ALLOW,
      actions: [
        'execute-api:ManageConnections',
        'execute-api:PostToConnection'
      ],
      // Allow access to all connections in this API
      resources: [
        `arn:aws:execute-api:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:${websocketApi.ref}/${props.stageName}/*`
      ]
    });
    
    // 2. Add the policy to your Lambda function
    wsProxyFunction.addToRolePolicy(webSocketConnectionPolicy);

    
    // `$connect` Routes
    const connectRoute = new CfnRoute(this, 'ConnectRoute', {
        apiId: websocketApi.ref,
        routeKey: '$connect',
        authorizationType: 'CUSTOM',
        authorizerId: authorizer.ref,
        target: `integrations/${integration.ref}`,
        routeResponseSelectionExpression: '$default',
        
    });

    // `$disconnect` Routes 
    const disconnectRoute = new CfnRoute(this, 'DisconnectRoute', {
        apiId: websocketApi.ref,
        routeKey: '$disconnect',
        authorizationType: 'NONE',
        target: `integrations/${integration.ref}`,
    });

    // `$default` Routes
    const defaultRoute = new CfnRoute(this, 'DefaultRoute', {
        apiId: websocketApi.ref,
        routeKey: '$default',
        authorizationType: 'NONE',
        target: `integrations/${integration.ref}`,
    });


    new CfnIntegrationResponse(this, 'ConnectIntegrationResponse', {
      apiId: websocketApi.ref,
      integrationId: integration.ref,
      integrationResponseKey: '$default',
      templateSelectionExpression: '\\$default',
    });

    // Add route responses for each route
    new CfnRouteResponse(this, 'ConnectRouteResponse', {
      apiId: websocketApi.ref,
      routeId: connectRoute.ref,
      routeResponseKey: '$default'
    });

    new CfnRouteResponse(this, 'DisconnectRouteResponse', {
      apiId: websocketApi.ref,
      routeId: disconnectRoute.ref,
      routeResponseKey: '$default'
    });

    new CfnRouteResponse(this, 'DefaultRouteResponse', {
      apiId: websocketApi.ref,
      routeId: defaultRoute.ref,
      routeResponseKey: '$default'
    });

    // WebSocket 스테이지 생성
    new CfnStage(this, 'WebSocketStage', {
        apiId: websocketApi.ref,
        stageName: 'prod',
        autoDeploy: true,
        defaultRouteSettings: {
          loggingLevel: 'INFO',
          dataTraceEnabled: true
        }
        
    });

    wsAuthorizerFunction.addPermission('wsAuthorizerPermission', {
      principal: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:${websocketApi.attrApiId}/authorizers/*`
    });
    wsProxyFunction.addPermission('wsProxyPermission', {
      principal: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:${websocketApi.attrApiId}/*/*`
    });
  }

}
