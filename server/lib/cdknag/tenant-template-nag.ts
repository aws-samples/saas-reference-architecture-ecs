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

    const nagEcsPath = `/tenant-template-stack-${props.tenantId}/EcsCluster`;
    const nagPath = `/tenant-template-stack-${props.tenantId}`;
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      `/tenant-template-stack-${props.tenantId}/IdentityProvider/TenantUserPool/Resource`,
      [
        {
          id: 'AwsSolutions-COG1',
          reason: 'Reference for SBT-ECS SaaS'
        },
        {
          id: 'AwsSolutions-COG3',
          reason: 'Reference for SBT-ECS SaaS is not using Advanced security feature'
        },
        {
          id: 'AwsSolutions-COG2',
          reason: 'Reference for SBT-ECS SaaS: MFA'
        }
      ]
    );
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [
        `/tenant-template-stack-${props.tenantId}/AWS679f53fac002430cb0da5b7982bd2287/ServiceRole/Resource`
      ],
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'This is not related with SaaS itself: SBT-ECS SaaS',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'
          ]
        }
      ]
    );
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [`/tenant-template-stack-${props.tenantId}/AWS679f53fac002430cb0da5b7982bd2287/Resource`],
      [
        {
          id: 'AwsSolutions-L1',
          reason: 'Reference for SBT-ECS SaaS'
        }
      ]
    );

    if('advanced' !== props.tier.toLocaleLowerCase() || 'INACTIVE' === props.advancedCluster ){
    if (props.isEc2Tier) {
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [
          `${nagEcsPath}/EniTrunking/CustomEniTrunkingRole/Resource`,
          `${nagEcsPath}/EniTrunking/EC2Role/Resource`,
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
          `${nagEcsPath}/EniTrunking/CustomEniTrunkingRole/Resource`,
        ],
        [
          {
            id: 'AwsSolutions-IAM4',
            reason: 'This is not related with SaaS itself: SBT-ECS SaaS',
            appliesTo: [
              'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'
            ]
          }
        ]
      );
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`${nagEcsPath}/EniTrunking/EC2Role/DefaultPolicy/Resource`],
        [
          {
            id: 'AwsSolutions-IAM5',
            reason: 'This is not related with SaaS itself: SBT-ECS SaaS',
            appliesTo: ['Action::ecs:Submit*', 'Resource::*']
          }
        ]
      );
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [
          `${nagEcsPath}/ecs-autoscaleG-${props.tenantId}/DrainECSHook/Function/ServiceRole/Resource`,
          `${nagEcsPath}/EcsCluster/launchTemplateRole/Resource`
        ],
        [
          {
            id: 'AwsSolutions-IAM4',
            reason: 'This is not related with SaaS itself: SBT-ECS SaaS',
            appliesTo: [
              'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
              'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role'
            ]
          }
        ]
      );
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`${nagEcsPath}/ecs-autoscaleG-${props.tenantId}/DrainECSHook/Function/Resource`],
        [
          {
            id: 'AwsSolutions-L1',
            reason: 'Reference for SBT-ECS SaaS'
          }
        ]
      );
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`${nagEcsPath}/ecs-autoscaleG-${props.tenantId}/ASG`],
        [
          {
            id: 'AwsSolutions-EC26',
            reason: 'Reference for SBT-ECS SaaS'
          }
        ]
      );
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`${nagEcsPath}/ecs-autoscaleG-${props.tenantId}/ASG`],
        [
          {
            id: 'AwsSolutions-AS3',
            reason: 'Reference for SBT-ECS SaaS'
          }
        ]
      );
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [
          `${nagEcsPath}/ecs-autoscaleG-${props.tenantId}/DrainECSHook/Function/ServiceRole/DefaultPolicy/Resource`
        ],
        [
          {
            id: 'AwsSolutions-IAM5',
            reason: 'Reference for SBT-ECS SaaS',
            appliesTo: [
              {
                regex: '/^Resource::arn:(.*):autoscaling:(.*):(.*)*$/g'
              },
              'Resource::*'
            ]
          }
        ]
      );
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`${nagEcsPath}/ecs-autoscaleG-${props.tenantId}/LifecycleHookDrainHook/Topic/Resource`],
        [
          {
            id: 'AwsSolutions-SNS2',
            reason: 'Reference for SBT-ECS SaaS'
          },
          {
            id: 'AwsSolutions-SNS3',
            reason: 'Reference for SBT-ECS SaaS'
          }
        ]
      );

      NagSuppressions.addResourceSuppressionsByPath(
            cdk.Stack.of(this),
            [
              "/tenant-template-stack-basic/orders-ecsTaskRole/Resource",
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
    // if(props.tier == 'basic'){    
if('advanced' !== props.tier.toLocaleLowerCase() || 'ACTIVE' === props.advancedCluster ) {
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`${nagPath}/MyPolicy/Resource`],
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
      [`${nagPath}/orders-EcsServices/ecsTaskExecutionRole-${props.tenantId}/Resource`,
      `${nagPath}/products-EcsServices/ecsTaskExecutionRole-${props.tenantId}/Resource`,
      `${nagPath}/users-EcsServices/ecsTaskExecutionRole-${props.tenantId}/Resource`
      ],
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
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [
        `${nagPath}/orders-EcsServices/orders-TaskDef/Resource`,
        `${nagPath}/products-EcsServices/products-TaskDef/Resource`,
        `${nagPath}/users-EcsServices/users-TaskDef/Resource`
      ],
      [
        {
          id: 'AwsSolutions-ECS2',
          reason: 'Reference for SBT-ECS SaaS'
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
    if (props.isRProxy) {
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`${nagPath}/rproxy-EcsServices/rproxy-TaskDef/Resource`],
        [
          {
            id: 'AwsSolutions-ECS2',
            reason: 'Reference for SBT-ECS SaaS'
          }
        ]
      );

      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`${nagPath}/rproxy-EcsServices/ecsTaskExecutionRole-${props.tenantId}/Resource`],
        [
          {
            id: 'AwsSolutions-IAM4',
            reason: 'Reference for SBT-ECS SaaS',
            appliesTo: [
              'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy'
            ]
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
}
