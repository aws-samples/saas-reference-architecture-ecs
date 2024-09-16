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

    const nagWebPath = '/core-appplane-stack/TenantWebUI/TenantWebUI';
    const nagCustomPath = '/core-appplane-stack/Custom::CDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C';

    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [
        'core-appplane-stack/provisioningScriptJob/codeBuildProvisionProjectRole/Resource',
        'core-appplane-stack/deprovisioningScriptJob/codeBuildProvisionProjectRole/Resource',
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
        `${nagWebPath}NpmBuildProject/Role/DefaultPolicy/Resource`,
        `${nagWebPath}CodePipeline/Role/DefaultPolicy/Resource`,
        `${nagWebPath}CodePipeline/Source/TenantWebUI/CodePipelineActionRole/DefaultPolicy/Resource`,
        `${nagWebPath}CodePipeline/Deploy/CopyToS3/CodePipelineActionRole/DefaultPolicy/Resource`,
        `${nagCustomPath}/ServiceRole/DefaultPolicy/Resource`
      ],
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'This is not related with SaaS itself: SBT-ECS SaaS',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
            {
              regex: '/^Resource::arn:aws:codebuild:(.*):(.*)\\*$/g'
            },
            {
              regex: '/^Resource::arn:aws:logs:(.*):(.*)\\*$/g'
            },
            {
              regex: '/^Resource::arn:aws:s3:(.*):(.*)\\*$/g'
            },
            {
              regex: '/^Resource::<saasapplicationuiTenantWebUI(.*)Bucket(.*).Arn(.*)\\*$/g'
            },
            {
              regex: '/^Resource::<TenantWebUI(.*).Arn(.*)\\*$/g'
            },
            {
              regex: '/^Resource::<StaticSiteDistroStaticSiteDistroBucket(.*).Arn(.*)\\*$/g'
            },
            'Resource::arn:<AWS::Partition>:logs:<AWS::Region>:<AWS::AccountId>:log-group:/aws/codebuild/<TenantWebUITenantWebUINpmBuildProject02E6ED86>:*',
            'Resource::arn:<AWS::Partition>:codebuild:<AWS::Region>:<AWS::AccountId>:report-group/<TenantWebUITenantWebUINpmBuildProject02E6ED86>-*',
            'Resource::<appsiteappsiteBucketDC62C27C.Arn>/*',
            'Resource::arn:<AWS::Partition>:s3:::cdk-hnb659fds-assets-<AWS::AccountId>-<AWS::Region>/*'
          ]
        },
        policy
      ]
    );
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      `${nagCustomPath}/ServiceRole/Resource`,
      [
        {
          id: 'AwsSolutions-IAM4',
          reason: 'CDK S3 Bucket for Ref',
          appliesTo: [
            'Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'
          ]
        }
      ]
    );
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [
        `/core-appplane-stack/TenantWebUI/AppSiteSourceCodeBucket/Resource`,
        `${nagWebPath}CodePipeline/ArtifactsBucket/Resource`
      ],
      [
        {
          id: 'AwsSolutions-S1',
          reason: 'CDK S3 Bucket for Ref',
        }
      ]
    );
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      [`${nagWebPath}NpmBuildProject/Resource`
      ],
      [
        {
          id: 'AwsSolutions-CB4',
          reason: 'CDK S3 Bucket for Ref',
        }
      ]
    );
    NagSuppressions.addResourceSuppressionsByPath(
      cdk.Stack.of(this),
      `${nagCustomPath}/Resource`,
      [
        {
          id: 'AwsSolutions-L1',
          reason: 'CDK S3 Bucket for Ref',
        }
      ]
    );
    // NagSuppressions.addResourceSuppressionsByPath(
    //   cdk.Stack.of(this),
    //   [
    //     `/core-appplane-stack/StaticSiteDistro/StaticSiteDistroDistribution/Resource`,
    //     `${nagWebPath}NpmBuildProject/Resource`
    //   ],
    //   [
    //     {
    //       id: 'AwsSolutions-CFR4',
    //       reason: 'ECS Reference Arch uses the default CloudFront viewer certificate.'
    //     },
    //     {
    //       id: 'AwsSolutions-CFR1',
    //       reason: 'Warning: ECS Reference Arch:Geo Restriction'
    //     },
    //     {
    //       id: 'AwsSolutions-CFR2',
    //       reason: 'Warning: ECS Reference Arch:WAF'
    //     },
    //     {
    //       id: 'AwsSolutions-CFR3',
    //       reason: 'Warning: ECS The CloudFront does not have access logging enabled'
    //     }
    //   ]
    // );

    // NagSuppressions.addResourceSuppressionsByPath(
    //   cdk.Stack.of(this),
    //   '/core-appplane-stack/TenantMappingTable/Resource',
    //   [
    //     {
    //       id: 'AwsSolutions-DDB3',
    //       reason: 'Warning: This ECS Reference Arch, Point-in-time Recovery not enabled'
    //     }
    //   ]
    // );
  }
}
