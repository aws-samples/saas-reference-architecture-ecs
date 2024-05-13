import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export class ControlPlaneNag extends Construct {
  constructor (scope: Construct, id: string) {
    super(scope, id);

    const policy = {
      id: 'AwsSolutions-IAM5',
      reason: 'Necessary to grant Get access to all objects for pipeline SBT-ECS SaaS Pipeline ',
      appliesTo: [
        'Action::s3:Abort*',
        'Action::s3:DeleteObject*',
        'Action::s3:GetBucket*',
        'Action::s3:GetObject*',
        'Action::s3:List*',
        'Action::kms:GenerateDataKey*',
        'Action::kms:ReEncrypt*',
        {
          regex: '/^Resource::<AdminWebUiAdmin(.*).Arn(.*)\\*$/g'
        },
        {
          regex: '/^Resource::<StaticSiteDistro(.*).Arn(.*)\\*$/g'
        }
      ]
    };

    const sbtPath = '/controlplane-stack/controlplane-sbt';
    const nagPath = '/controlplane-stack/AdminWebUi/AdminWebUi';
    const nagSitePath = '/controlplane-stack/StaticSiteDistro/StaticSiteDistro';

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [
        `${sbtPath}/controlplane-api-stack/controlPlaneAPI/EventsRole/DefaultPolicy/Resource`,
        `${sbtPath}/services-stack/tenantManagementExecRole/DefaultPolicy/Resource`,
        `${sbtPath}/auth-info-service-stack/TenantConfigServiceLambda/ServiceRole/DefaultPolicy/Resource`
      ],
      [
        policy,
        {
          id: 'AwsSolutions-IAM5',
          reason: 'This Nag is from sbt-aws module',
          appliesTo: [
            {
              regex: '/^Resource::arn:aws:execute-api:(.*):(.*)\\*$/g'
            },
            {
              regex: '/^Resource::<controlplanesbttablesstackTenant(.*).Arn(.*)\\*$/g'
            }
          ]
        }
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [
        `${nagPath}CodePipeline/Role/DefaultPolicy/Resource`,
        `${nagPath}CodePipeline/Source/Checkout/CodePipelineActionRole/DefaultPolicy/Resource`,
        `${nagPath}CodePipeline/Deploy/CopyToS3/CodePipelineActionRole/DefaultPolicy/Resource`
      ],
      [policy],
      true
    );

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      `${nagPath}NpmBuildProject/Role/DefaultPolicy/Resource`,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'This is not related with SaaS itself: SBT-ECS SaaS',
          appliesTo: [
            {
              regex: '/^Resource::arn:aws:logs:(.*):(.*)\\*$/g'
            },
            {
              regex: '/^Resource::arn:aws:codebuild:(.*):(.*)\\*$/g'
            }
          ]
        },
        policy
      ]
    );

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      `${nagSitePath}Distribution/Resource`,
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
  }
}
