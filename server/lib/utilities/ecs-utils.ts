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
  containerDef: ecs.ContainerDefinitionOptions,
): ecs.TaskDefinition {
  const familyName = `${containerDef.containerName}-TaskDef`
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
      cpu: containerDef.cpu || 256,
      memoryLimitMiB: containerDef.memoryLimitMiB || 512,
    });
  }
};

// Mapping function definition
export function getContainerDefinitionOptions(
  stack: cdk.Stack,
  jsonConfig: any,
  idpDetails: IdentityDetails
): ecs.ContainerDefinitionOptions {
  // Set default environment values (region and account)
  const defaultEnvironmentVariables = {
    AWS_REGION: cdk.Stack.of(stack).region,
    AWS_ACCOUNT_ID: cdk.Stack.of(stack).account,
    COGNITO_USER_POOL_ID: idpDetails.details.userPoolId,
    COGNITO_CLIENT_ID: idpDetails.details.appClientId,
    COGNITO_REGION: cdk.Stack.of(stack).region,
  };

  // Dynamically add environment values
  const environmentVariables = {
    ...defaultEnvironmentVariables, // Apply default values first
    ...(jsonConfig.environment || {}), // Apply additional values from JSON
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

  // Create ContainerDefinitionOptions
  const containerOptions: ecs.ContainerDefinitionOptions = {
    containerName: jsonConfig.name,
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
      appProtocol: appProtocolMap[port.appProtocol], // Map ecs.AppProtocol value or default to HTTP
      protocol:  protocolMap[port.protocol] //|| ecs.Protocol.TCP,
    })),
    environment: environmentVariables, // 
    healthCheck: jsonConfig.healthCheck ? {
      command: jsonConfig.healthCheck.command,
      interval: cdk.Duration.seconds(jsonConfig.healthCheck.interval),
      timeout: cdk.Duration.seconds(jsonConfig.healthCheck.timeout),
      retries: jsonConfig.healthCheck.retries,
      startPeriod: cdk.Duration.seconds(jsonConfig.healthCheck.startPeriod)
    } : undefined,
   
    logging: ecs.LogDriver.awsLogs({ streamPrefix: 'ecs-container-logs' })
  };

  return containerOptions;
}