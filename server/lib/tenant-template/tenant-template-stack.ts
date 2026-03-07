import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import { type Construct } from "constructs";
import { type Table } from "aws-cdk-lib/aws-dynamodb";
import { IdentityProvider } from "./identity-provider";
import { EcsCluster } from "./ecs-cluster";
import { TenantTemplateNag } from "../cdknag/tenant-template-nag";
import { addTemplateTag } from "../utilities/helper-functions";
import { HttpNamespace } from "aws-cdk-lib/aws-servicediscovery";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";

interface TenantTemplateStackProps extends cdk.StackProps {
  stageName: string;
  tenantId: string;
  tenantName: string;
  tenantMappingTable: Table;
  commitId: string;
  waveNumber?: string;
  tier: string;
  advancedCluster: string;
  appSiteUrl: string;
  useFederation: string;
  useEc2?: boolean;
  useRProxy?: boolean;
}

export class TenantTemplateStack extends cdk.Stack {
  cluster: ecs.ICluster;
  namespace: HttpNamespace;

  constructor(scope: Construct, id: string, props: TenantTemplateStackProps) {
    super(scope, id, props);
    const waveNumber = props.waveNumber || "1";
    addTemplateTag(this, "TenantTemplateStack");

    // appSiteUrl: read from shared-infra-stack CloudFormation Export
    // props.appSiteUrl is fallback (when injected directly via CodeBuild env vars)
    const appSiteUrl = props.appSiteUrl || cdk.Fn.importValue('AppSiteUrl');

    const identityProvider = new IdentityProvider(this, "IdentityProvider", {
      tenantId: props.tenantId,
      tenantName: props.tenantName,
      tier: props.tier,
      appSiteUrl: appSiteUrl,
      useFederation: props.useFederation,
    });

    const vpc = ec2.Vpc.fromVpcAttributes(this, "Vpc", {
      vpcId: cdk.Fn.importValue("EcsVpcId"),
      availabilityZones: cdk.Fn.split(
        ",",
        cdk.Fn.importValue("AvailabilityZones")
      ),
      privateSubnetIds: cdk.Fn.split(
        ",",
        cdk.Fn.importValue("PrivateSubnetIds")
      ),
    });

    // SG for ALB to ECS & ECS services's communication
    const ecsSG = new ec2.SecurityGroup(this, "ecsSG", {
      vpc: vpc,
      allowAllOutbound: true,
    });

    // Configuration values with clear defaults
    const isEc2Tier: boolean = props.useEc2 ?? false;
    const isRProxy: boolean = props.useRProxy ?? true;

    // Clear condition variables for better readability
    const isAdvancedTier = props.tier.toLocaleLowerCase() === "advanced";
    const isAdvancedActive = props.advancedCluster === "ACTIVE";
    const shouldDeployServices = !isAdvancedTier || isAdvancedActive;

    // ECS Cluster setup based on tier and status
    if (isAdvancedTier && isAdvancedActive) {
      // Reference existing Advanced cluster
      const clusterName = `${props.stageName}-advanced-${
        cdk.Stack.of(this).account
      }`;
      this.cluster = ecs.Cluster.fromClusterAttributes(this, "advanced", {
        clusterName: clusterName,
        vpc: vpc,
        securityGroups: [],
      });
    } else {
      // Create new cluster for Basic/Premium or inactive Advanced
      const ecsCluster = new EcsCluster(this, "EcsCluster", {
        vpc: vpc,
        stageName: props.stageName,
        tenantId: props.tenantId,
        tier: props.tier,
        isEc2Tier,
      });
      this.cluster = ecsCluster.cluster;
    }

    // Create Cloud Map namespace when services will be deployed
    if (shouldDeployServices) {
      this.namespace = new HttpNamespace(this, "CloudMapNamespace", {
        name: `${props.tenantName}`,
      });
    }

    new AwsCustomResource(this, "CreateTenantMapping", {
      installLatestAwsSdk: true,
      onCreate: {
        service: "DynamoDB",
        action: "putItem",
        physicalResourceId: PhysicalResourceId.of("CreateTenantMapping"),
        parameters: {
          TableName: props.tenantMappingTable.tableName,
          Item: {
            tenantId: { S: props.tenantId },
            stackName: { S: cdk.Stack.of(this).stackName },
            codeCommitId: { S: props.commitId },
            waveNumber: { S: waveNumber },
          },
        },
      },
      onUpdate: {
        service: "DynamoDB",
        action: "updateItem",
        physicalResourceId: PhysicalResourceId.of("CreateTenantMapping"),
        parameters: {
          TableName: props.tenantMappingTable.tableName,
          Key: {
            tenantId: { S: props.tenantId },
          },
          UpdateExpression: "set codeCommitId = :codeCommitId",
          ExpressionAttributeValues: {
            ":codeCommitId": { S: props.commitId },
          },
        },
      },
      onDelete: {
        service: "DynamoDB",
        action: "deleteItem",
        parameters: {
          TableName: props.tenantMappingTable.tableName,
          Key: {
            tenantId: { S: props.tenantId },
          },
        },
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: [props.tenantMappingTable.tableArn],
      }),
    });

    new cdk.CfnOutput(this, "TenantUserpoolId", {
      value: identityProvider.tenantUserPool.userPoolId,
    });

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: identityProvider.tenantUserPoolClient.userPoolClientId,
    });

    new cdk.CfnOutput(this, "S3SourceVersion", {
      value: props.commitId,
    });

    // Export values for tenant-service-stack to consume
    const exportPrefix = `tenant-${props.tenantId}`;

    new cdk.CfnOutput(this, "ClusterName", {
      value: this.cluster.clusterName,
      exportName: `${exportPrefix}-ClusterName`,
    });

    new cdk.CfnOutput(this, "EcsSgId", {
      value: ecsSG.securityGroupId,
      exportName: `${exportPrefix}-EcsSgId`,
    });

    if (shouldDeployServices && this.namespace) {
      new cdk.CfnOutput(this, "NamespaceArn", {
        value: this.namespace.namespaceArn,
        exportName: `${exportPrefix}-NamespaceArn`,
      });

      new cdk.CfnOutput(this, "NamespaceName", {
        value: this.namespace.namespaceName,
        exportName: `${exportPrefix}-NamespaceName`,
      });
    }

    new cdk.CfnOutput(this, "CognitoUserPoolId", {
      value: identityProvider.tenantUserPool.userPoolId,
      exportName: `${exportPrefix}-UserPoolId`,
    });

    new cdk.CfnOutput(this, "CognitoClientId", {
      value: identityProvider.tenantUserPoolClient.userPoolClientId,
      exportName: `${exportPrefix}-ClientId`,
    });

    new cdk.CfnOutput(this, "CognitoIssuer", {
      value: `https://cognito-idp.${cdk.Stack.of(this).region}.amazonaws.com/${identityProvider.tenantUserPool.userPoolId}`,
      exportName: `${exportPrefix}-CognitoIssuer`,
    });

    // CDK Nag check (controlled by environment variable)
    if (process.env.CDK_NAG_ENABLED === "true") {
      new TenantTemplateNag(this, "TenantInfraNag", {
        tenantId: props.tenantId,
        isEc2Tier,
        tier: props.tier,
        advancedCluster: props.advancedCluster,
        isRProxy,
      });
    }
  }
}
