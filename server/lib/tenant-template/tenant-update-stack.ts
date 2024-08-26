import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as fs from 'fs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { type Table } from 'aws-cdk-lib/aws-dynamodb';
import { ECSSaaSPipelineNag } from '../cdknag/ecs-saas-pipeline-nag';
import { type Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import { addTemplateTag } from '../utilities/helper-functions';

export interface TenantUpdatePipelineProps extends cdk.StackProps {
  tenantMappingTable: Table
  bucketName: string
}

export class TenantUpdatePipeline extends cdk.Stack {
  constructor (scope: Construct, id: string, props: TenantUpdatePipelineProps) {
    super(scope, id, props);
    addTemplateTag(this, 'TenantUpdatePipeline');

    const accessLogsBucket = new s3.Bucket(this, 'AccessLogsBucket', {
      enforceSSL: true,
      autoDeleteObjects: true,
      accessControl: cdk.aws_s3.BucketAccessControl.LOG_DELIVERY_WRITE,
      removalPolicy: RemovalPolicy.DESTROY
    });

    const artifactBucket = new s3.Bucket(this, 'ArtifactsBucket', {
      enforceSSL: true,
      serverAccessLogsBucket: accessLogsBucket,
      encryptionKey: new cdk.aws_kms.Key(this, 'saas-ecs', {
        enableKeyRotation: true
      })
    });

    const defaultPolicy = new cdk.aws_iam.PolicyDocument({
      statements: [
        new cdk.aws_iam.PolicyStatement({
          actions: [
            's3:AbortMultipartUpload',
            's3:PutObject',
            's3:PutObjectLegalHold',
            's3:PutObjectRetention',
            's3:PutObjectTagging',
            's3:PutObjectVersionTagging'
          ],
          resources: [artifactBucket.bucketArn],
          effect: iam.Effect.ALLOW
        }),
        new cdk.aws_iam.PolicyStatement({
          actions: ['sts:AssumeRole'],
          resources: ['*']
        }),
        new cdk.aws_iam.PolicyStatement({
          actions: ['kms:Decrypt', 'kms:DescribeKey', 'kms:Encrypt'],
          resources: ['*']
        })
      ]
    });

    const deployerRole = new iam.Role(this, 'deployerRole', {
      assumedBy: new iam.CompositePrincipal(
        new iam.ServicePrincipal('codebuild.amazonaws.com'),
        new iam.ServicePrincipal('codepipeline.amazonaws.com')
      ),
      inlinePolicies: { DefaultPolicy: defaultPolicy }
    }).withoutPolicyUpdates();

    const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      artifactBucket,
      pipelineType: codepipeline.PipelineType.V2,

      role: deployerRole
    });

    
    const sourceOutput = new codepipeline.Artifact();
    const sourceArtifact = new codepipeline.Artifact();

    const sourceCodeBucket = new s3.Bucket(this, 'SourceCodeBucket', {
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
    });

    pipeline.addStage({
      stageName: 'Source',
      actions: [
        new codepipeline_actions.S3SourceAction({
          actionName: 'S3Source',
          bucket: sourceCodeBucket,
          bucketKey: 'source-code/somehash',//new StringConcat().join('source-code/', hash),
          output: sourceArtifact,
          trigger: codepipeline_actions.S3Trigger.NONE
        })

      ]
    });

    const buildOutput = new codepipeline.Artifact();

    const buildProject = new codebuild.PipelineProject(this, 'Deploy', {
      buildSpec: codebuild.BuildSpec.fromObject({
        version: 0.2,
        env: {
          shell: 'bash',
          variables: {
            tenantMappingTableName: props.tenantMappingTable.tableName,
            CDK_PARAM_S3_BUCKET_NAME: props.bucketName
          }
        },
        phases: {
          install: {
            'runtime-versions': {
              python: 3.11,
              nodejs: 18
            }
          },
          build: {
            commands: [fs.readFileSync('../scripts/update-tenants.sh', 'utf8')]
          }
        }
      }),
      role: deployerRole,
      environment: { buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_5, privileged: true }
    });

    // reduce permission scope
    buildProject.addToRolePolicy(
      new iam.PolicyStatement({
        resources: ['*'],
        actions: ['*']
      })
    );

    pipeline.addStage({
      stageName: 'Build',
      actions: [
        new codepipeline_actions.CodeBuildAction({
          actionName: 'Build-ECS-SaaS',
          project: buildProject,
          input: sourceOutput,
          outputs: [buildOutput],
          environmentVariables: {
            CDK_PARAM_COMMIT_ID: {
              value: '#{SourceVariables.CommitId}'
            }
          }
        })
      ]
    });

    new cdk.CfnOutput(this, 'ECSSaaSPipeline', {
      value: pipeline.pipelineName
    });

    new ECSSaaSPipelineNag(this, 'EcsSaasPipelineNag');
  }
}
