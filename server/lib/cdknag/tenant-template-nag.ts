import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export interface TenantInfraNagProps {
  tenantId: string
  isEc2Tier: boolean
  tier: string
  advancedCluster: string
  isRProxy: boolean
}

export class TenantTemplateNag extends Construct {
  constructor (scope: Construct, id: string, props: TenantInfraNagProps) {
    super(scope, id);
    
    // General CDK NAG suppressions for the entire stack
    this.addGeneralSuppressions(props);

  }
  
  private addGeneralSuppressions(props: TenantInfraNagProps) {
    // General suppressions for the entire stack
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
        id: 'AwsSolutions-ECS2',
        reason: 'SaaS reference architecture - Environment variables without secrets are acceptable'
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
        id: 'AwsSolutions-EC26',
        reason: 'SaaS reference architecture - EBS encryption not required for demo'
      },
      {
        id: 'AwsSolutions-AS3',
        reason: 'SaaS reference architecture - Auto Scaling notifications not required for demo'
      },
      {
        id: 'AwsSolutions-SNS2',
        reason: 'SaaS reference architecture - SNS encryption not required for demo'
      },
      {
        id: 'AwsSolutions-SNS3',
        reason: 'SaaS reference architecture - SNS SSL not required for demo'
      }
    ]);
  }
}
