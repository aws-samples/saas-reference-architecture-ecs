import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export interface SharedInfraNagProps {
  stageName: string
}

export class SharedInfraNag extends Construct {
  constructor (scope: Construct, id: string, props: SharedInfraNagProps) {
    super(scope, id);

    const nagApiPath = `/shared-infra-stack/ApiGateway/TenantApi`;
    const nagAuthPath = '/shared-infra-stack/ApiGateway/AuthorizerFunction';

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      ['/shared-infra-stack/sbt-ecs-alb/Resource', '/shared-infra-stack/sbt-ecs-nlb/Resource'],
      [
        {
          id: 'AwsSolutions-ELB2',
          reason: 'Reference for SBT-ECS SaaS'
        }
      ]
    );
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      ['/shared-infra-stack/alb-sg/Resource'],
      [
        {
          id: 'CdkNagValidationFailure',
          reason: 'Warning: Reference for SBT-ECS SaaS, '
        }
      ]
    );
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      `${nagApiPath}/CloudWatchRole/Resource`,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'Role used to simplify pushing logs to CloudWatch.',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs'
          ]
        }
      ]
    );
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [`${nagAuthPath}Role/Resource`, `${nagAuthPath}Role/DefaultPolicy/Resource`],
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'This is not related with SaaS itself: SBT-ECS SaaS',
          appliesTo: ['Resource::*']
        }
      ]
    );
    NagSuppressions.addResourceSuppressionsByPath(cdk.Stack.of(this), `${nagAuthPath}/Resource`, [
      {
        id: 'AwsSolutions-L1',
        reason: 'Reference for SBT-ECS SaaS'
      }
    ]);

    NagSuppressions.addResourceSuppressionsByPath(cdk.Stack.of(this), `${nagApiPath}/Resource`, [
      {
        id: 'AwsSolutions-APIG2',
        reason: 'Reference for SBT-ECS SaaS'
      }
    ]);
    // NagSuppressions.addResourceSuppressionsByPath(
    //   cdk.Stack.of(this),
    //   `${nagApiPath}/DeploymentStage.prod/Resource`,
    //   [
    //     {
    //       id: 'AwsSolutions-APIG3',
    //       reason: 'Warning: Reference for SBT-ECS SaaS'
    //     }
    //   ]
    // );

    // const micros = ['orders', 'products', 'users'];
    // for (let i = 0; i < micros.length; i++) {
    //   NagSuppressions.addResourceSuppressionsByPath(
    //     cdk.Stack.of(this),
    //     [
    //       `${nagApiPath}/Default/${micros[i]}/OPTIONS/Resource`,
    //       `${nagApiPath}/Default/${micros[i]}/GET/Resource`,
    //       `${nagApiPath}/Default/${micros[i]}/POST/Resource`,
    //       `${nagApiPath}/Default/${micros[i]}/{id}/OPTIONS/Resource`,
    //       `${nagApiPath}/Default/${micros[i]}/{id}/GET/Resource`,
    //       `${nagApiPath}/Default/${micros[i]}/{id}/PUT/Resource`,
    //       `${nagApiPath}/Default/${micros[i]}/{id}/DELETE/Resource`,
    //       `${nagApiPath}/Default/OPTIONS/Resource`
    //     ],
    //     [
    //       {
    //         id: 'AwsSolutions-COG4',
    //         reason:
    //           'Use Authorizer lambda because Cognito is replaceable.Reference for SBT-ECS SaaS'
    //       },
    //       {
    //         id: 'AwsSolutions-APIG4',
    //         reason: 'Reference for SBT-ECS SaaS'
    //       }
    //     ]
    //   );
    // }



    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [
        `/shared-infra-stack/adminsite/adminsiteDistribution/Resource`,
        `/shared-infra-stack/appsite/appsiteDistribution/Resource`
      ],
      [
        {
          id: 'AwsSolutions-CFR4',
          reason: 'ECS Reference Arch uses the default CloudFront viewer certificate.'
        },
        {
          id: 'AwsSolutions-CFR1',
          reason: 'Warning: ECS Reference Arch:Geo Restriction'
        },
        {
          id: 'AwsSolutions-CFR2',
          reason: 'Warning: ECS Reference Arch:WAF'
        },
        {
          id: 'AwsSolutions-CFR3',
          reason: 'Warning: ECS The CloudFront does not have access logging enabled'
        }
      ]
    );

    if(process.env.CDK_USE_DB === 'mysql') {
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`/shared-infra-stack/RdsCluster/RdsSecurityGroup/Resource`],
        [
          {
            id: 'AwsSolutions-EC23',
            reason: 'This is not related with SaaS itself: SBT-ECS SaaS',
          }
        ]
      );

      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this), `/shared-infra-stack/RdsCluster/DbSecret/Resource`, [
        {
          id: 'AwsSolutions-SMG4',
          reason: 'Reference for SBT-ECS SaaS'
        },
      ]);
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this), `/shared-infra-stack/RdsCluster/SbtRDSCluster/Resource`, [
        {
          id: 'AwsSolutions-RDS6',
          reason: 'Reference for SBT-ECS SaaS'
        },
        {
          id: 'AwsSolutions-RDS10',
          reason: 'Reference for SBT-ECS SaaS'
        },
        {
          id: 'AwsSolutions-RDS11',
          reason: 'Reference for SBT-ECS SaaS'
        },
        {
          id: 'AwsSolutions-RDS14',
          reason: 'Reference for SBT-ECS SaaS'
        },
      ]);
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`/shared-infra-stack/RdsCluster/SecretsManagerSeviceAccessPolicy/Resource`],
        [
          {
            id: 'AwsSolutions-IAM5',
            reason: 'This is not related with SaaS itself: SBT-ECS SaaS',
            appliesTo: ['Resource::arn:<AWS::Partition>:secretsmanager:<AWS::Region>:<AWS::AccountId>:secret:rds_proxy_multitenant/proxy_secret_for_user*']
          }
        ]
      );
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`/shared-infra-stack/RdsCluster/LambdaAddUsersRole/Resource`,],
        [
          {
            id: 'AwsSolutions-IAM4',
            reason: 'This is not related with SaaS itself: SBT-ECS SaaS',
            appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/AWSXRayDaemonWriteAccess',
              'Policy::arn:<AWS::Partition>:iam::aws:policy/CloudWatchLogsFullAccess',
              'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole'
            ]
          }
        ]
      );
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`/shared-infra-stack/RdsCluster/LambdaAddUsersRole/DefaultPolicy/Resource`],
        [
          {
            id: 'AwsSolutions-IAM5',
            reason: 'This is not related with SaaS itself: SBT-ECS SaaS',
            appliesTo: ['Resource::arn:aws:secretsmanager:<AWS::Region>:<AWS::AccountId>:secret:rds_proxy_multitenant/proxy_secret_for_user*',
              'Resource::arn:aws:rds:<AWS::Region>:<AWS::AccountId>:db-proxy:*',
              'Resource::*'
            ]
          }
        ]
      );
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this), `/shared-infra-stack/RdsCluster/MySqlDababase/Resource`, [
        {
          id: 'AwsSolutions-L1',
          reason: 'Reference for SBT-ECS SaaS'
        },
      ]);
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this), `/shared-infra-stack/RdsCluster/STSRole/Resource`, [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Reference for SBT-ECS SaaS',
          appliesTo: ['Resource::arn:aws:rds-db:<AWS::Region>:<AWS::AccountId>:dbuser:*']
        },
      ]);
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this), `/shared-infra-stack/RdsCluster/sbt-ecsTaskRole/Resource`, [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'Reference for SBT-ECS SaaS',
          appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role']
        },
      ]);
     
    }
  }
}
