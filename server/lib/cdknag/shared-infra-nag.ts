import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export interface SharedInfraNagProps {
  stageName: string
}

export class SharedInfraNag extends Construct {
  constructor (scope: Construct, id: string, props: SharedInfraNagProps) {
    super(scope, id);
    
    // General CDK NAG suppressions for the entire stack
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
        id: 'AwsSolutions-VPC7',
        reason: 'SaaS reference architecture - VPC Flow Logs are configured'
      },
      {
        id: 'AwsSolutions-ELB2',
        reason: 'SaaS reference architecture - ALB access logging not required for demo'
      },
      {
        id: 'AwsSolutions-EC23',
        reason: 'SaaS reference architecture - Security group rules are appropriate for demo'
      },
      {
        id: 'AwsSolutions-APIG2',
        reason: 'SaaS reference architecture - API Gateway request validation not required for demo'
      },
      {
        id: 'AwsSolutions-APIG3',
        reason: 'SaaS reference architecture - API Gateway WAF not required for demo'
      },
      {
        id: 'AwsSolutions-APIG4',
        reason: 'SaaS reference architecture - API Gateway authorization configured appropriately'
      },
      {
        id: 'AwsSolutions-CFR1',
        reason: 'SaaS reference architecture - CloudFront geo restriction not required for demo'
      },
      {
        id: 'AwsSolutions-CFR2',
        reason: 'SaaS reference architecture - CloudFront WAF not required for demo'
      },
      {
        id: 'AwsSolutions-CFR3',
        reason: 'SaaS reference architecture - CloudFront access logging not required for demo'
      },
      {
        id: 'AwsSolutions-CFR4',
        reason: 'SaaS reference architecture - CloudFront TLS 1.2 is configured'
      },
      {
        id: 'AwsSolutions-S1',
        reason: 'SaaS reference architecture - S3 access logging not required for demo'
      },
      {
        id: 'AwsSolutions-S2',
        reason: 'SaaS reference architecture - S3 public access is controlled'
      },
      {
        id: 'AwsSolutions-S10',
        reason: 'SaaS reference architecture - S3 SSL is enforced'
      },
      {
        id: 'AwsSolutions-L1',
        reason: 'SaaS reference architecture - Lambda runtime versions are acceptable for demo'
      }
    ]);
    
    // Additional MySQL-related suppressions (conditional)

    if(process.env.CDK_USE_DB === 'mysql') {
      // Additional MySQL-related suppressions
      NagSuppressions.addStackSuppressions(cdk.Stack.of(this), [
        {
          id: 'AwsSolutions-RDS6',
          reason: 'SaaS reference architecture - RDS IAM authentication not required for demo'
        },
        {
          id: 'AwsSolutions-RDS10',
          reason: 'SaaS reference architecture - RDS deletion protection not required for demo'
        },
        {
          id: 'AwsSolutions-RDS11',
          reason: 'SaaS reference architecture - RDS default port is acceptable for demo'
        },
        {
          id: 'AwsSolutions-RDS14',
          reason: 'SaaS reference architecture - RDS backtrack not required for demo'
        },
        {
          id: 'AwsSolutions-SMG4',
          reason: 'SaaS reference architecture - Secrets Manager rotation not required for demo'
        }
      ]);
    }
  }
}
