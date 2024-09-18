import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export interface TenantServiceNagProps {
  tenantId: string
  isEc2Tier: boolean
  tier: string
  isRProxy: boolean
}

export class TenantServiceNag extends Construct {
  constructor (scope: Construct, id: string, props: TenantServiceNagProps) {
    super(scope, id);

    const nagPath = `/tenant-template-stack-${props.tenantId}/EcsServices`;

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      `${nagPath}/ecsTaskExecutionRole-${props.tenantId}/Resource`,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'This is not related with SaaS itself: SBT-ECS SaaS',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy'
          ]
        }
      ]
    );
    
    // if('advanced' !== props.tier.toLocaleLowerCase() || 'ACTIVE' === props.advancedCluster ) {
    // if(props.tier == 'basic'){    
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [`${nagPath}/ecsTaskExecutionRole-${props.tenantId}/DefaultPolicy/Resource`],
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'This is not related with SaaS itself: SBT-ECS SaaS',
          appliesTo: ['Resource::*']
        }
      ]
    );
   
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
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [
        `${nagPath}/orders-TaskDef/Resource`,
        `${nagPath}/products-TaskDef/Resource`,
        `${nagPath}/users-TaskDef/Resource`
      ],
      [
        {
          id: 'AwsSolutions-ECS2',
          reason: 'Reference for SBT-ECS SaaS'
        }
      ]
    );

    if (props.isRProxy) {
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`${nagPath}/rproxy-TaskDef/Resource`],
        [
          {
            id: 'AwsSolutions-ECS2',
            reason: 'Reference for SBT-ECS SaaS'
          }
        ]
      );
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        `${nagPath}/rProxy-taskRole/Resource`,
        [
          {
            id: 'AwsSolutions-IAM4',
            reason: 'This is not related with SaaS itself: SBT-ECS SaaS',
            appliesTo: [
              'Policy::arn:<AWS::Partition>:iam::aws:policy/CloudWatchAgentServerPolicy',
              'Policy::arn:<AWS::Partition>:iam::aws:policy/CloudWatchFullAccess'
            ]
          }
        ]
      );
    }
  }
}
