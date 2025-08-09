import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export interface TenantServiceNagProps {
  tenantId: string
  isEc2Tier: boolean
  isRProxy: boolean
}

export class TenantServiceNag extends Construct {
  constructor (scope: Construct, id: string, props: TenantServiceNagProps) {
    super(scope, id);

    const nagPath = `/tenant-template-stack-${props.tenantId}`;
   
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [
        `${nagPath}/orders-ecsTaskRole/Resource`,
        `${nagPath}/products-ecsTaskRole/Resource`,
        `${nagPath}/users-ecsTaskRole/Resource`
      ],
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'This is not related with SaaS itself: SBT-ECS SaaS',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role'
          ]
        }
      ]
    );
    
  }
}
