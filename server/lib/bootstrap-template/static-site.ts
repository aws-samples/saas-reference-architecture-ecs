import * as cdk from "aws-cdk-lib";
import type * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as codepipeline from "aws-cdk-lib/aws-codepipeline";
import * as codepipeline_actions from "aws-cdk-lib/aws-codepipeline-actions";
import * as s3deployment from "aws-cdk-lib/aws-s3-deployment";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { Fn, RemovalPolicy } from "aws-cdk-lib";
import { addTemplateTag } from "../utilities/helper-functions";

export interface StaticSiteProps {
  readonly name: string;
  readonly assetDirectory: string;
  readonly siteConfig: Record<string, any>;
  readonly defaultBranchName?: string;
  readonly distribution: cloudfront.Distribution;
  readonly appBucket: s3.IBucket;
  accessLogsBucket: s3.Bucket;
  env: cdk.Environment;
}

export class StaticSite extends Construct {
  readonly repositoryUrl: string;

  constructor(scope: Construct, id: string, props: StaticSiteProps) {
    super(scope, id);
    addTemplateTag(this, "StaticSiteReact");

    // S3 bucket to hold updated code
    const sourceCodeBucket = new s3.Bucket(
      this,
      `${props.name}SourceCodeBucket`,
      {
        autoDeleteObjects: true,
        removalPolicy: RemovalPolicy.DESTROY,
        encryption: s3.BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        versioned: true,
      }
    );

    const bucketDeployment = new s3deployment.BucketDeployment(
      this,
      props.name,
      {
        sources: [s3deployment.Source.asset(props.assetDirectory)],
        destinationBucket: sourceCodeBucket,
        destinationKeyPrefix: props.name,
        extract: false,
        prune: false,
        memoryLimit: 1024,
      }
    );

    const buildProject = new codebuild.PipelineProject(
      this,
      `${id}ReactBuildProject`,
      {
        environment: {
          buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        },
        buildSpec: codebuild.BuildSpec.fromObject({
          version: "0.2",
          phases: {
            install: {
              "runtime-versions": {
                nodejs: "22",
              },
              commands: [
                "npm install --legacy-peer-deps --no-optional",
              ],
            },
            build: {
              commands: [
                // React approach: Create environment configuration in src/config folder
                "mkdir -p ./src/config",
                `cat > ./src/config/environment.ts << 'EOF'\nexport const environment = ${JSON.stringify(
                  props.siteConfig,
                  null,
                  2
                )};\nexport default environment;\nEOF`,

                "npm run build || npm run build:fallback || GENERATE_SOURCEMAP=false npm run build",
              ],
            },
          },
          artifacts: {
            files: ["**/*"],
            "base-directory": "build",
          },
        }),
        environmentVariables: {},
      }
    );

    const pipeline = new codepipeline.Pipeline(this, `${id}CodePipeline`, {
      crossAccountKeys: false,
      restartExecutionOnUpdate: true,
      pipelineType: codepipeline.PipelineType.V2,
    });

    // Source Stage - Exactly the same approach as existing StaticSite
    const sourceArtifact = new codepipeline.Artifact();
    const hash: string = Fn.select(0, bucketDeployment.objectKeys);

    pipeline.addStage({
      stageName: "Source",
      actions: [
        new codepipeline_actions.S3SourceAction({
          actionName: `${id}`,
          bucket: sourceCodeBucket,
          bucketKey: `${props.name}/${hash}`,
          output: sourceArtifact,
        }),
      ],
    });

    // Build Stage
    const buildOutput = new codepipeline.Artifact();
    pipeline.addStage({
      stageName: "Build",
      actions: [
        new codepipeline_actions.CodeBuildAction({
          actionName: "CompileReactSite",
          input: sourceArtifact,
          project: buildProject,
          outputs: [buildOutput],
        }),
      ],
    });

    // Deploy Stage - Deploy to correct S3 bucket
    pipeline.addStage({
      stageName: "Deploy",
      actions: [
        new codepipeline_actions.S3DeployAction({
          actionName: "CopyToS3",
          bucket: props.appBucket, // Correct bucket connected to CloudFront
          input: buildOutput,
          cacheControl: [
            codepipeline_actions.CacheControl.fromString("no-store"),
          ],
          runOrder: 1,
        }),
      ],
    });

    pipeline.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["codebuild:StartBuild"],
        resources: [buildProject.projectArn],
        effect: iam.Effect.ALLOW,
      })
    );
  }
}
