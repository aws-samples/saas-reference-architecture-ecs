import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { NagSuppressions } from "cdk-nag";

export interface TenantInfraNagProps {
  tenantId: string;
  isEc2Tier: boolean;
  tier: string;
  advancedCluster: string;
  isRProxy: boolean;
}

export class TenantTemplateNag extends Construct {
  constructor(scope: Construct, id: string, props: TenantInfraNagProps) {
    super(scope, id);

    const nagEcsPath = `/tenant-template-stack-${props.tenantId}/EcsCluster`;
    const nagPath = `/tenant-template-stack-${props.tenantId}`;

    // Cognito suppressions
    this.addCognitoSuppressions(props, nagPath);

    // Lambda suppressions for custom resources
    this.addLambdaSuppressions(props, nagPath);

    // EC2 mode specific suppressions
    if (props.isEc2Tier) {
      this.addEc2Suppressions(props, nagEcsPath);
    }

    // Service suppressions - apply for all cases where services are deployed
    // This covers: basic tier, premium tier, and advanced tier (both INACTIVE and ACTIVE)
    this.addServiceSuppressions(props, nagPath);
  }

  private addCognitoSuppressions(props: TenantInfraNagProps, nagPath: string) {
    try {
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        `${nagPath}/IdentityProvider/TenantUserPool/Resource`,
        [
          {
            id: "AwsSolutions-COG1",
            reason:
              "SaaS reference architecture - Password policy is configured appropriately",
          },
          {
            id: "AwsSolutions-COG3",
            reason:
              "SaaS reference architecture - Advanced security features not required for demo",
          },
          {
            id: "AwsSolutions-COG2",
            reason:
              "SaaS reference architecture - MFA not required for demo purposes",
          },
        ]
      );
    } catch (error) {
      console.log(
        "Cognito User Pool resource not found, skipping suppressions"
      );
    }
  }

  private addLambdaSuppressions(props: TenantInfraNagProps, nagPath: string) {
    try {
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`${nagPath}/AWS679f53fac002430cb0da5b7982bd2287/ServiceRole/Resource`],
        [
          {
            id: "AwsSolutions-IAM4",
            reason:
              "SaaS reference architecture - AWS managed policies acceptable for demo",
            appliesTo: [
              "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
            ],
          },
        ]
      );
    } catch (error) {
      console.log(
        "Lambda ServiceRole resource not found, skipping suppression"
      );
    }

    try {
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`${nagPath}/AWS679f53fac002430cb0da5b7982bd2287/Resource`],
        [
          {
            id: "AwsSolutions-L1",
            reason:
              "SaaS reference architecture - Lambda runtime acceptable for demo",
          },
        ]
      );
    } catch (error) {
      console.log("Lambda resource not found, skipping suppression");
    }
  }

  private addEc2Suppressions(props: TenantInfraNagProps, nagEcsPath: string) {
    // ENI Trunking suppressions
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [
        `${nagEcsPath}/EniTrunking/CustomEniTrunkingRole/Resource`,
        `${nagEcsPath}/EniTrunking/EC2Role/Resource`,
      ],
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "SaaS reference architecture - AWS managed policies acceptable for demo",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role",
          ],
        },
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [`${nagEcsPath}/EniTrunking/CustomEniTrunkingRole/Resource`],
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "SaaS reference architecture - AWS managed policies acceptable for demo",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
          ],
        },
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [`${nagEcsPath}/EniTrunking/EC2Role/DefaultPolicy/Resource`],
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "SaaS reference architecture - Wildcard permissions acceptable for demo",
          appliesTo: ["Action::ecs:Submit*", "Resource::*"],
        },
      ]
    );

    // Launch Template Role suppression
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [`${nagEcsPath}/EcsCluster/launchTemplateRole/Resource`],
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "SaaS reference architecture - AWS managed policies acceptable for demo",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role",
          ],
        },
      ]
    );

    // Auto Scaling Group suppressions
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [
        `${nagEcsPath}/ecs-autoscaleG-${props.tenantId}/DrainECSHook/Function/ServiceRole/Resource`,
      ],
      [
        {
          id: "AwsSolutions-IAM4",
          reason:
            "SaaS reference architecture - AWS managed policies acceptable for demo",
          appliesTo: [
            "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
          ],
        },
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [
        `${nagEcsPath}/ecs-autoscaleG-${props.tenantId}/DrainECSHook/Function/Resource`,
      ],
      [
        {
          id: "AwsSolutions-L1",
          reason:
            "SaaS reference architecture - Lambda runtime acceptable for demo",
        },
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [`${nagEcsPath}/ecs-autoscaleG-${props.tenantId}/ASG`],
      [
        {
          id: "AwsSolutions-EC26",
          reason:
            "SaaS reference architecture - EBS encryption not required for demo",
        },
        {
          id: "AwsSolutions-AS3",
          reason:
            "SaaS reference architecture - Auto Scaling notifications not required for demo",
        },
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [
        `${nagEcsPath}/ecs-autoscaleG-${props.tenantId}/DrainECSHook/Function/ServiceRole/DefaultPolicy/Resource`,
      ],
      [
        {
          id: "AwsSolutions-IAM5",
          reason:
            "SaaS reference architecture - Wildcard permissions acceptable for demo",
          appliesTo: [
            {
              regex: "/^Resource::arn:(.*):autoscaling:(.*):(.*)*$/g",
            },
            "Resource::*",
          ],
        },
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [
        `${nagEcsPath}/ecs-autoscaleG-${props.tenantId}/LifecycleHookDrainHook/Topic/Resource`,
      ],
      [
        {
          id: "AwsSolutions-SNS2",
          reason:
            "SaaS reference architecture - SNS encryption not required for demo",
        },
        {
          id: "AwsSolutions-SNS3",
          reason: "SaaS reference architecture - SNS SSL not required for demo",
        },
      ]
    );
  }

  private addServiceSuppressions(props: TenantInfraNagProps, nagPath: string) {
    // Use try-catch to handle resources that may not exist
    try {
      // ECS Task Execution Role suppressions
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [
          `${nagPath}/orders-EcsServices/ecsTaskExecutionRole-${props.tenantId}/Resource`,
          `${nagPath}/products-EcsServices/ecsTaskExecutionRole-${props.tenantId}/Resource`,
          `${nagPath}/users-EcsServices/ecsTaskExecutionRole-${props.tenantId}/Resource`,
        ],
        [
          {
            id: "AwsSolutions-IAM4",
            reason:
              "SaaS reference architecture - AWS managed policies acceptable for demo",
            appliesTo: [
              "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
            ],
          },
        ]
      );
    } catch (error) {
      console.log(
        "Some ECS Task Execution Role resources not found, skipping suppressions"
      );
    }

    try {
      // ECS Task Definition suppressions
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [
          `${nagPath}/orders-EcsServices/orders-TaskDef/Resource`,
          `${nagPath}/products-EcsServices/products-TaskDef/Resource`,
          `${nagPath}/users-EcsServices/users-TaskDef/Resource`,
        ],
        [
          {
            id: "AwsSolutions-ECS2",
            reason:
              "SaaS reference architecture - Environment variables acceptable for demo",
          },
        ]
      );
    } catch (error) {
      console.log(
        "Some ECS Task Definition resources not found, skipping suppressions"
      );
    }

    try {
      // ECS Task Role suppressions
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [
          `${nagPath}/orders-ecsTaskRole/Resource`,
          `${nagPath}/products-ecsTaskRole/Resource`,
          `${nagPath}/users-ecsTaskRole/Resource`,
        ],
        [
          {
            id: "AwsSolutions-IAM4",
            reason:
              "SaaS reference architecture - AWS managed policies acceptable for demo",
            appliesTo: [
              "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role",
            ],
          },
        ]
      );
    } catch (error) {
      console.log(
        "Some ECS Task Role resources not found, skipping suppressions"
      );
    }

    try {
      // ECS Task Role Default Policy suppressions (for wildcard permissions)
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [
          `${nagPath}/orders-ecsTaskRole/DefaultPolicy/Resource`,
          `${nagPath}/products-ecsTaskRole/DefaultPolicy/Resource`,
          `${nagPath}/users-ecsTaskRole/DefaultPolicy/Resource`,
        ],
        [
          {
            id: "AwsSolutions-IAM5",
            reason:
              "SaaS reference architecture - Wildcard permissions acceptable for demo",
            appliesTo: ["Resource::*"],
          },
        ]
      );
    } catch (error) {
      console.log(
        "Some ECS Task Role Default Policy resources not found, skipping suppressions"
      );
    }

    try {
      // Additional Policy suppressions (for DynamoDB access)
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [`${nagPath}/ordersAdditionalPolicy/Resource`],
        [
          {
            id: "AwsSolutions-IAM5",
            reason:
              "SaaS reference architecture - Wildcard permissions acceptable for demo",
            appliesTo: ["Resource::*"],
          },
        ]
      );
    } catch (error) {
      console.log("Additional Policy resource not found, skipping suppression");
    }

    try {
      // Task Definition suppressions (direct path)
      NagSuppressions.addResourceSuppressionsByPath(
        cdk.Stack.of(this),
        [
          `${nagPath}/orders-TaskDef/Resource`,
          `${nagPath}/products-TaskDef/Resource`,
          `${nagPath}/users-TaskDef/Resource`,
        ],
        [
          {
            id: "AwsSolutions-ECS2",
            reason:
              "SaaS reference architecture - Environment variables acceptable for demo",
          },
        ]
      );
    } catch (error) {
      console.log(
        "Some Task Definition resources not found, skipping suppressions"
      );
    }

    // rProxy suppressions
    if (props.isRProxy) {
      try {
        NagSuppressions.addResourceSuppressionsByPath(
          cdk.Stack.of(this),
          [`${nagPath}/rproxy-EcsServices/rproxy-TaskDef/Resource`],
          [
            {
              id: "AwsSolutions-ECS2",
              reason:
                "SaaS reference architecture - Environment variables acceptable for demo",
            },
          ]
        );
      } catch (error) {
        console.log(
          "rProxy Task Definition resource not found, skipping suppression"
        );
      }

      try {
        NagSuppressions.addResourceSuppressionsByPath(
          cdk.Stack.of(this),
          [
            `${nagPath}/rproxy-EcsServices/ecsTaskExecutionRole-${props.tenantId}/Resource`,
          ],
          [
            {
              id: "AwsSolutions-IAM4",
              reason:
                "SaaS reference architecture - AWS managed policies acceptable for demo",
              appliesTo: [
                "Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
              ],
            },
          ]
        );
      } catch (error) {
        console.log(
          "rProxy Task Execution Role resource not found, skipping suppression"
        );
      }

      try {
        NagSuppressions.addResourceSuppressionsByPath(
          cdk.Stack.of(this),
          `${nagPath}/rProxy-taskRole/Resource`,
          [
            {
              id: "AwsSolutions-IAM4",
              reason:
                "SaaS reference architecture - AWS managed policies acceptable for demo",
              appliesTo: [
                "Policy::arn:<AWS::Partition>:iam::aws:policy/CloudWatchAgentServerPolicy",
                "Policy::arn:<AWS::Partition>:iam::aws:policy/CloudWatchFullAccess",
              ],
            },
          ]
        );
      } catch (error) {
        console.log(
          "rProxy Task Role resource not found, skipping suppression"
        );
      }

      try {
        NagSuppressions.addResourceSuppressionsByPath(
          cdk.Stack.of(this),
          `${nagPath}/rProxy-taskRole/DefaultPolicy/Resource`,
          [
            {
              id: "AwsSolutions-IAM5",
              reason:
                "SaaS reference architecture - Wildcard permissions acceptable for demo",
              appliesTo: ["Resource::*"],
            },
          ]
        );
      } catch (error) {
        console.log(
          "rProxy Task Role Default Policy resource not found, skipping suppression"
        );
      }

      try {
        NagSuppressions.addResourceSuppressionsByPath(
          cdk.Stack.of(this),
          [`${nagPath}/rproxy-TaskDef/Resource`],
          [
            {
              id: "AwsSolutions-ECS2",
              reason:
                "SaaS reference architecture - Environment variables acceptable for demo",
            },
          ]
        );
      } catch (error) {
        console.log(
          "rProxy Task Definition resource not found, skipping suppression"
        );
      }
    }
  }
}
