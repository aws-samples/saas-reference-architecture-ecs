import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import { type Construct } from "constructs";
import { type Table } from "aws-cdk-lib/aws-dynamodb";
import { IdentityProvider } from "./identity-provider";
import { EcsCluster } from "./ecs-cluster";
import { EcsService } from "./services";
import { TenantTemplateNag } from "../cdknag/tenant-template-nag";
import { addTemplateTag } from "../utilities/helper-functions";
import { ContainerInfo } from "../interfaces/container-info";
import { HttpNamespace } from "aws-cdk-lib/aws-servicediscovery";
import { EcsDynamoDB } from "./ecs-dynamodb";
import path = require("path");
import * as fs from "fs";
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
  productServiceUri: string;
  orderServiceUri: string;
  cluster: ecs.ICluster;
  namespace: HttpNamespace;

  constructor(scope: Construct, id: string, props: TenantTemplateStackProps) {
    super(scope, id, props);
    const waveNumber = props.waveNumber || "1";
    addTemplateTag(this, "TenantTemplateStack");

    const identityProvider = new IdentityProvider(this, "IdentityProvider", {
      tenantId: props.tenantId,
      tenantName: props.tenantName,
      tier: props.tier,
      appSiteUrl: props.appSiteUrl,
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

    // Deploy services conditionally
    if (shouldDeployServices) {
      this.namespace = new HttpNamespace(this, "CloudMapNamespace", {
        name: `${props.tenantName}`,
      });

      const data = fs.readFileSync(
        path.resolve(__dirname, "../service-info.json"),
        "utf8"
      );
      const replacements: { [key: string]: string } = {
        "<NAMESPACE>": this.namespace.namespaceName,
      };

      let updateData = data;
      for (const [placeholder, replacement] of Object.entries(replacements)) {
        const regex = new RegExp(placeholder, "g");
        updateData = updateData.replace(regex, replacement);
      }

      const serviceInfo = JSON.parse(updateData);
      const containerInfo: ContainerInfo[] = serviceInfo.Containers;

      // Deploy core services (orders, products, users) in parallel first
      const coreServices: EcsService[] = [];

      containerInfo.forEach((info) => {
        // Create storage if needed for the service
        const storage = this.createStorageIfNeeded(info, props.tenantName);

        // Create IAM task role for the service
        const taskRole = this.createTaskRole(info, storage, identityProvider);

        // Create ECS service
        const ecsService = new EcsService(this, `${info.name}-EcsServices`, {
          tenantId: props.tenantId,
          tenantName: props.tenantName,
          isEc2Tier,
          isRProxy,
          isTarget: !isRProxy,
          vpc: vpc,
          cluster: this.cluster,
          ecsSG: ecsSG,
          taskRole,
          namespace: this.namespace,
          info,
          identityDetails: identityProvider.identityDetails,
        });

        // Set up dependencies
        ecsService.service.node.addDependency(this.cluster);
        ecsService.service.node.addDependency(vpc);

        // Store core services for rproxy dependency
        coreServices.push(ecsService);
      });

      if (isRProxy) {
        this.deployRProxyService(
          serviceInfo,
          props,
          vpc,
          ecsSG,
          identityProvider,
          isEc2Tier,
          isRProxy,
          coreServices
        );
      }
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

  /**
   * Create DynamoDB storage if the service requires it
   */
  private createStorageIfNeeded(
    info: ContainerInfo,
    tenantName: string
  ): EcsDynamoDB | undefined {
    if (info.hasOwnProperty("database") && info.database?.kind === "dynamodb") {
      const storage = new EcsDynamoDB(this, `${info.name}Storage`, {
        name: info.name,
        partitionKey: "tenantId",
        sortKey: info.database.sortKey || "",
        tableName: `${info.environment?.TABLE_NAME.replace(
          /_/g,
          "-"
        ).toLowerCase()}-${tenantName}`,
        tenantName: tenantName,
      });

      // Update environment variable with actual table name
      info.environment.TABLE_NAME = storage.table.tableName;
      return storage;
    }
    return undefined;
  }

  /**
   * Create IAM task role for ECS service
   */
  private createTaskRole(
    info: ContainerInfo,
    storage: EcsDynamoDB | undefined,
    identityProvider: IdentityProvider
  ): iam.Role {
    let policy = JSON.stringify(info.policy);

    if (storage) {
      // Create main ECS task role first
      const taskRole = new iam.Role(this, `${info.name}-ecsTaskRole`, {
        assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AmazonEC2ContainerServiceforEC2Role"
          ),
        ],
      });

      // Create ABAC role with proper Trust Policy from the start
      const abacRole = new iam.Role(this, `${info.name}-ABACRole`, {
        assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        inlinePolicies: {
          DynamoDBTenantAccess: storage.policyDocument
        }
      });

      // Add Task Role to ABAC Role Trust Policy with conditions
      abacRole.assumeRolePolicy?.addStatements(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          principals: [new iam.ArnPrincipal(taskRole.roleArn)],
          actions: ["sts:AssumeRole", "sts:TagSession"],
          conditions: {
            StringLike: {
              "aws:RequestTag/tenant": "*"
            }
          }
        })
      );

      // Add ABAC role assume permission to task role
      taskRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["sts:AssumeRole", "sts:TagSession"],
          resources: [abacRole.roleArn],
          conditions: {
            StringLike: {
              "aws:RequestTag/tenant": "*"
            }
          }
        })
      );

      // Add environment variables for TokenVendingMachine
      info.environment = info.environment || {};
      info.environment.IAM_ROLE_ARN = abacRole.roleArn;
      info.environment.REQUEST_TAG_KEYS_MAPPING_ATTRIBUTES = '{"tenant":"custom:tenantId"}';
      info.environment.IDP_DETAILS = JSON.stringify({
        issuer: identityProvider.identityDetails.details.issuer,
        audience: identityProvider.identityDetails.details.clientId
      });

      // Attach additional policy if exists (e.g., SSM)
      if (policy) {
        taskRole.attachInlinePolicy(
          new iam.Policy(this, `${info.name}AdditionalPolicy`, {
            document: iam.PolicyDocument.fromJson(JSON.parse(policy)),
          })
        );
      }

      return taskRole;
    } else {
      // Create role for stateless service
      policy = policy.replace(
        /<USER_POOL_ID>/g,
        identityProvider.identityDetails.details.userPoolId
      );
      return new iam.Role(this, `${info.name}-ecsTaskRole`, {
        assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        inlinePolicies: {
          EcsContainerInlinePolicy: iam.PolicyDocument.fromJson(
            JSON.parse(policy)
          ),
        },
      });
    }
  }

  /**
   * Deploy rProxy service with dependencies on core services
   */
  private deployRProxyService(
    serviceInfo: any,
    props: TenantTemplateStackProps,
    vpc: ec2.IVpc,
    ecsSG: ec2.SecurityGroup,
    identityProvider: IdentityProvider,
    isEc2Tier: boolean,
    isRProxy: boolean,
    coreServices: EcsService[]
  ): void {
    const rProxyInfo: ContainerInfo = serviceInfo.Rproxy;

    // Create IAM role for rProxy with CloudWatch permissions
    const taskRole = new iam.Role(this, `rProxy-taskRole`, {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy")
    );
    taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchFullAccess")
    );

    // Create rProxy ECS service
    const rproxyService = new EcsService(this, `rproxy-EcsServices`, {
      tenantId: props.tenantId,
      tenantName: props.tenantName,
      isEc2Tier,
      isRProxy,
      isTarget: isRProxy,
      vpc: vpc,
      cluster: this.cluster,
      ecsSG: ecsSG,
      taskRole,
      namespace: this.namespace,
      info: rProxyInfo,
      identityDetails: identityProvider.identityDetails,
    });

    // rProxy depends on ALL core services (orders, products, users)
    coreServices.forEach((coreService) => {
      rproxyService.service.node.addDependency(coreService.service);
    });
  }
}
