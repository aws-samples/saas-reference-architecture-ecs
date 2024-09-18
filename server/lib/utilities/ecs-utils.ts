import { DynamoDBClient, QueryCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

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
  taskRole: iam.Role,
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