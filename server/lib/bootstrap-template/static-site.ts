import type * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codecommit from 'aws-cdk-lib/aws-codecommit';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as kms from 'aws-cdk-lib/aws-kms';
import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import { addTemplateTag } from '../utilities/helper-functions';

export interface StaticSiteProps {
  readonly name: string
  readonly assetDirectory: string
  readonly production: boolean
  readonly clientId?: string
  readonly issuer?: string
  readonly apiUrl: string
  readonly wellKnownEndpointUrl?: string
  readonly defaultBranchName?: string
  readonly distribution: cloudfront.Distribution
  readonly appBucket: s3.Bucket
  accessLogsBucket: s3.Bucket
}

export class StaticSite extends Construct {
  readonly repositoryUrl: string;

  constructor (scope: Construct, id: string, props: StaticSiteProps) {
    super(scope, id);
    addTemplateTag(this, 'StaticSite');
    const defaultBranchName = props.defaultBranchName ?? 'main';
    const repository = new codecommit.Repository(this, `${id}Repository`, {
      repositoryName: props.name,
      description: `Repository with code for ${props.name}`,
      code: codecommit.Code.fromDirectory(props.assetDirectory, defaultBranchName)
    });
    repository.applyRemovalPolicy(RemovalPolicy.DESTROY);
    this.repositoryUrl = repository.repositoryCloneUrlHttp;

    this.createCICD(
      id,
      repository,
      defaultBranchName,
      props.production,
      props.apiUrl,
      props.appBucket,
      props.accessLogsBucket,
      props.clientId,
      props.issuer,
      props.wellKnownEndpointUrl
    );
  }

  private createCICD (
    id: string,
    repo: codecommit.Repository,
    branchName: string,
    production: boolean,
    apiUrl: string,
    appBucket: s3.Bucket,
    accessLogsBucket: s3.Bucket,
    clientId?: string,
    issuer?: string,
    wellKnownEndpointUrl?: string
  ) {
    const artifactBucket = new s3.Bucket(this, `${id}CodePipelineBucket`, {
      enforceSSL: true,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      serverAccessLogsBucket: accessLogsBucket,
      encryptionKey: new kms.Key(this, 'npm-ecs', {
        enableKeyRotation: true
      })
    });

    const pipeline = new codepipeline.Pipeline(this, `${id}CodePipeline`, {
      crossAccountKeys: false,
      artifactBucket,
      pipelineType: codepipeline.PipelineType.V2
    });

    const sourceArtifact = new codepipeline.Artifact();
    const siteConfig = {
      production: production,
      clientId: clientId,
      issuer: issuer,
      apiUrl: apiUrl,
      wellKnownEndpointUrl: wellKnownEndpointUrl
    };

    pipeline.addStage({
      stageName: 'Source',
      actions: [
        new actions.CodeCommitSourceAction({
          actionName: 'Checkout',
          repository: repo,
          output: sourceArtifact,
          branch: branchName
        })
      ]
    });

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

    const buildOutput = new codepipeline.Artifact();

    pipeline.addStage({
      stageName: 'Build',
      actions: [
        new actions.CodeBuildAction({
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
        new actions.S3DeployAction({
          actionName: 'CopyToS3',
          bucket: appBucket,
          input: buildOutput,
          cacheControl: [actions.CacheControl.fromString('no-store')],
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
