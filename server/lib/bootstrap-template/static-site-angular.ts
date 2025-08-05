import * as cdk from 'aws-cdk-lib';
import type * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as s3deployment from 'aws-cdk-lib/aws-s3-deployment';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { Fn, RemovalPolicy } from 'aws-cdk-lib';
import { addTemplateTag } from '../utilities/helper-functions';


export interface StaticSiteAngularProps {
  readonly name: string
  readonly assetDirectory: string
  readonly production: boolean
  readonly clientId?: string
  readonly issuer?: string
  readonly apiUrl: string
  readonly wellKnownEndpointUrl?: string
  readonly defaultBranchName?: string
  readonly distribution: cloudfront.Distribution
  readonly appBucket: s3.IBucket
  accessLogsBucket: s3.Bucket
  env: cdk.Environment
}

export class StaticSiteAngular extends Construct {
  readonly repositoryUrl: string;

  constructor (scope: Construct, id: string, props: StaticSiteAngularProps) {
    super(scope, id);
    addTemplateTag(this, 'StaticSite');

    // S3 bucket to hold updated code
    const sourceCodeBucket = new s3.Bucket(this, `${props.name}SourceCodeBucket`, {
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
    });

    const bucketDeployment = new s3deployment.BucketDeployment(this, props.name, {
      sources: [s3deployment.Source.asset(props.assetDirectory)],
      destinationBucket: sourceCodeBucket,
      destinationKeyPrefix: props.name, //'source-code',
      extract: false,
      prune: false,
      memoryLimit: 1024, // 메모리를 1GB로 증가
    });

    const siteConfig = {
      production: props.production,
      clientId: props.clientId,
      issuer: props.issuer,
      apiUrl: props.apiUrl,
      wellKnownEndpointUrl: props.wellKnownEndpointUrl,
    };
    const buildProject = new codebuild.PipelineProject(this, `${id}NpmBuildProject`, {
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            commands: ['npm install --force']
          },
          build: {
            commands: [
              `echo 'export const environment = ${JSON.stringify(
                siteConfig
              )}' > ./src/environments/environment.prod.ts`,
              `echo 'export const environment = ${JSON.stringify(
                siteConfig
              )}' > ./src/environments/environment.ts`,
              'npm run build'
            ]
          }
        },
        artifacts: {
          files: ['**/*'],
          'base-directory': 'dist'
        }
      }),
      environmentVariables: {}
    });

    const pipeline = new codepipeline.Pipeline(this, `${id}CodePipeline`, {
      crossAccountKeys: false,
      restartExecutionOnUpdate: true,
      pipelineType: codepipeline.PipelineType.V2,
    });

    //Source Stage
    const sourceArtifact = new codepipeline.Artifact();
    const hash: string = Fn.select(0, bucketDeployment.objectKeys);
    pipeline.addStage({
      stageName: 'Source',
      actions: [
        new codepipeline_actions.S3SourceAction({
          actionName: `${id}`,
          bucket: sourceCodeBucket,
          bucketKey: `${props.name}/${hash}`,
          output: sourceArtifact,
        }),
      ]
    });

    //Build Stage
    const buildOutput = new codepipeline.Artifact();
    pipeline.addStage({
      stageName: 'Build',
      actions: [
        new codepipeline_actions.CodeBuildAction({
          actionName: 'CompileNgSite',
          input: sourceArtifact,
          project: buildProject,
          outputs: [buildOutput]
        })
      ]
    });

    pipeline.addStage({
      stageName: 'Deploy',
      actions: [
        new codepipeline_actions.S3DeployAction({
          actionName: 'CopyToS3',
          bucket: props.appBucket,
          input: buildOutput,
          cacheControl: [codepipeline_actions.CacheControl.fromString('no-store')],
          runOrder: 1
        })
      ]
    });

    pipeline.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['codebuild:StartBuild'],
        resources: [buildProject.projectArn], // invalidateBuildProject.projectArn],
        effect: iam.Effect.ALLOW
      })
    );
  }

}
