import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';

export class ECSSaaSPipelineNag extends Construct {
  constructor (scope: Construct, id: string) {
    super(scope, id);

    const nagPath1 = '/tenant-update-stack';
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [`${nagPath1}/deployerRole/Resource`],
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'This is not related with SaaS itself',
          appliesTo: ['Resource::*']
        }
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [`${nagPath1}/Deploy/Resource`],
      [
        {
          id: 'AwsSolutions-CB3',
          reason: 'SBT-ECS SaaS:The CodeBuild project has privileged mode enabled'
        }
      ]
    );
  }
}
