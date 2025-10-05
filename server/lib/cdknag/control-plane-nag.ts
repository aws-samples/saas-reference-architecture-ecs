import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export class ControlPlaneNag extends Construct {
  constructor (scope: Construct, id: string) {
    super(scope, id);
    
    // General CDK NAG exception handling for the entire stack
    NagSuppressions.addStackSuppressions(cdk.Stack.of(this), [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'SaaS reference architecture - AWS managed policies are acceptable for demo purposes'
      },
      {
        id: 'AwsSolutions-IAM5',
        reason: 'SaaS reference architecture - Wildcard permissions are acceptable for demo purposes'
      },
      {
        id: 'AwsSolutions-COG1',
        reason: 'SaaS reference architecture - Password policy is configured appropriately'
      },
      {
        id: 'AwsSolutions-COG2',
        reason: 'SaaS reference architecture - MFA not required for demo purposes'
      },
      {
        id: 'AwsSolutions-COG3',
        reason: 'SaaS reference architecture - Advanced security features not required for demo'
      },
      {
        id: 'AwsSolutions-L1',
        reason: 'SaaS reference architecture - Lambda runtime versions are acceptable'
      },
      {
        id: 'AwsSolutions-S1',
        reason: 'SaaS reference architecture - S3 access logging not required for demo'
      },
      {
        id: 'AwsSolutions-CB4',
        reason: 'SaaS reference architecture - CodeBuild KMS encryption not required for demo'
      }
    ]);
  }
}
