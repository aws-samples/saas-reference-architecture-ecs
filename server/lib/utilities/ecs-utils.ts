import { DynamoDBClient, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { ContainerDefinitionConfig } from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';
import { IdentityDetails } from '../interfaces/identity-details';

export function getServiceName(cfnService: cdk.aws_ecs.CfnService, tenantName: string, name: string  ): void {
  const alphaNumericName = `${tenantName}`.replace(/[^a-zA-Z0-9]/g, '');  // tenantName
  cfnService.serviceName = `${name}${alphaNumericName}`;
  cfnService.overrideLogicalId(cfnService.serviceName);
  cfnService.enableExecuteCommand = true;
}

export function createTaskDefinition (
  scope: Construct,
  isEc2Tier: boolean,
  taskExecutionRole: iam.Role,
  taskRole: iam.IRole| undefined,
  familyName: string
): ecs.TaskDefinition {
  const baseProps = {
    executionRole: taskExecutionRole,
    taskRole: taskRole,
    family: familyName
  };

  if (isEc2Tier) {
    return new ecs.Ec2TaskDefinition(scope, familyName, {
      ...baseProps,
      networkMode: ecs.NetworkMode.AWS_VPC
    });
  } else {
    return new ecs.FargateTaskDefinition(scope, familyName, {
      ...baseProps,
      memoryLimitMiB: 512
    });
  }
};

// 매핑 함수 정의
export function getContainerDefinitionOptions(
  stack: cdk.Stack,
  jsonConfig: any,
  idpDetails: IdentityDetails
): ecs.ContainerDefinitionOptions {
  // 기본 environment 값 설정 (region과 account)
  const defaultEnvironmentVariables = {
    AWS_REGION: cdk.Stack.of(stack).region,
    AWS_ACCOUNT_ID: cdk.Stack.of(stack).account,
    COGNITO_USER_POOL_ID: idpDetails.details.userPoolId,
    COGNITO_CLIENT_ID: idpDetails.details.appClientId,
    COGNITO_REGION: cdk.Stack.of(stack).region,
  };

  // 동적으로 environment 값 추가
  const environmentVariables = {
    ...defaultEnvironmentVariables, // 기본 값 먼저 적용
    ...(jsonConfig.environment || {}), // JSON에서 추가한 값 적용
  };

  const appProtocolMap: { [key: string]: ecs.AppProtocol } = {
    'ecs.AppProtocol.http': ecs.AppProtocol.http,
    'ecs.AppProtocol.http2': ecs.AppProtocol.http2,
    'ecs.AppProtocol.grpc': ecs.AppProtocol.grpc,
  };

  const protocolMap: { [key: string]: ecs.Protocol } = {
    'ecs.Protocol.TCP': ecs.Protocol.TCP,
    'ecs.Protocol.UDP': ecs.Protocol.UDP,
  };

  // ContainerDefinitionOptions 생성
  const containerOptions: ecs.ContainerDefinitionOptions = {
    image: ecs.ContainerImage.fromRegistry(jsonConfig.image),
    cpu: jsonConfig.cpu,
    memoryLimitMiB: jsonConfig.memoryLimitMiB,
    // portMappings: jsonConfig.portMappings?.map((port: any) => ({
    //   name: port.name,
    //   containerPort: port.containerPort,
    //   appProtocol: ecs.AppProtocol.http, 
    //   protocol: port.protocol //ecs.Protocol.TCP, // Default TCP
    // })),
    portMappings: jsonConfig.portMappings?.map((port: any) => ({
      name: port.name,
      containerPort: port.containerPort,
      appProtocol: protocolMap[port.appProtocolMap] || ecs.AppProtocol.http, // ecs.AppProtocol 값을 매핑하거나 기본값 HTTP// ecs.AppProtocol 값을 매핑하거나 기본값 HTTP 할당
      protocol:  protocolMap[port.protocol] || ecs.Protocol.TCP,
    })),
    environment: environmentVariables, // 
    logging: ecs.LogDriver.awsLogs({ streamPrefix: 'ecs-container-logs' })

  };

  return containerOptions;
}