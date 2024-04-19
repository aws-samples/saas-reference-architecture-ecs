import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export class CoreAppPlaneNag extends Construct {
  constructor (scope: Construct, id: string) {
    super(scope, id);

    const policy = {
      id: 'AwsSolutions-IAM5',
      reason: 'Reference for SBT-ECS SaaS',
      appliesTo: [
        'Action::s3:Abort*',
        'Action::s3:DeleteObject*',
        'Action::s3:GetBucket*',
        'Action::s3:GetObject*',
        'Action::s3:List*',
        'Action::s3:*',
        'Action::kms:GenerateDataKey*',
        'Action::kms:ReEncrypt*'
      ]
    };

    const sbtNagPath = '/coreappplane-stack/coreappplane-sbt';
    const nagWebPath = '/coreappplane-stack/saas-application-ui/TenantWebUI';
    const nagStaticPath = '/coreappplane-stack/saas-application-ui/StaticSiteDistro';

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [
        `${sbtNagPath}/provisioning-codeBuildProvisionProjectRole/Resource`,
        `${sbtNagPath}/deprovisioning-codeBuildProvisionProjectRole/Resource`
      ],
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'This CDK-NAG is from sbt-aws module',
          appliesTo: ['Action::*', 'Resource::*']
        }
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [
        `${nagWebPath}/TenantWebUICodePipeline/Source/Checkout/CodePipelineActionRole/DefaultPolicy/Resource`,
        `${nagWebPath}/TenantWebUICodePipeline/Deploy/CopyToS3/CodePipelineActionRole/DefaultPolicy/Resource`
      ],
      [
        policy,
        {
          id: 'AwsSolutions-IAM5',
          reason: 'This is not related with SaaS itself: SBT-ECS SaaS',
          appliesTo: [
            {
              regex: '/^Resource::<saasapplicationui(.*).Arn(.*)\\*$/g'
            }
          ]
        }
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [
        `${nagWebPath}/TenantWebUICodePipeline/Role/DefaultPolicy/Resource`,
        `${nagWebPath}/TenantWebUINpmBuildProject/Role/DefaultPolicy/Resource`
      ],
      [
        policy,
        {
          id: 'AwsSolutions-IAM5',
          reason: 'This is not related with SaaS itself: SBT-ECS SaaS',
          appliesTo: [
            {
              regex: '/^Resource::<saasapplicationui(.*).Arn(.*)\\*$/g'
            },
            {
              regex: '/^Resource::arn:aws:logs:(.*):(.*)\\*$/g'
            },
            {
              regex: '/^Resource::arn:aws:codebuild:(.*):(.*)\\*$/g'
            }
          ]
        }
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      `${nagStaticPath}/StaticSiteDistroDistribution/Resource`,
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

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      '/coreappplane-stack/TenantMappingTable/Resource',
      [
        {
          id: 'AwsSolutions-DDB3',
          reason: 'Warning: This ECS Reference Arch, Point-in-time Recovery not enabled'
        }
      ]
    );
  }
}
