import * as cdk from "aws-cdk-lib";
import { Aws } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import { type Construct } from "constructs";
import { EcsService } from "./services";
import { EcsDynamoDB } from "./ecs-dynamodb";
import { addTemplateTag } from "../utilities/helper-functions";
import { ContainerInfo } from "../interfaces/container-info";
import { IdentityDetails } from "../interfaces/identity-details";
import { HttpNamespace } from "aws-cdk-lib/aws-servicediscovery";
import path = require("path");
import * as fs from "fs";

interface TenantServiceStackProps extends cdk.StackProps {
  tenantId: string;
  tenantName: string;
  tier: string;
  advancedCluster: string;
  appSiteUrl: string;
  useEc2?: boolean;
  useRProxy?: boolean;
}

export class TenantServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: TenantServiceStackProps) {
    super(scope, id, props);
    addTemplateTag(this, "TenantServiceStack");

    const isEc2Tier: boolean = props.useEc2 ?? false;
    const isRProxy: boolean = props.useRProxy ?? true;
    const isAdvancedTier = props.tier.toLocaleLowerCase() === "advanced";
    const isAdvancedActive = props.advancedCluster === "ACTIVE";
    const shouldDeployServices = !isAdvancedTier || isAdvancedActive;

    if (!shouldDeployServices) {
      return; // Nothing to deploy for inactive Advanced tier
    }

    // Import values from tenant-template-stack
    const exportPrefix = `tenant-${props.tenantId}`;

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

    const clusterName = cdk.Fn.importValue(`${exportPrefix}-ClusterName`);
    const cluster = ecs.Cluster.fromClusterAttributes(this, "Cluster", {
      clusterName: clusterName,
      vpc: vpc,
      securityGroups: [],
    });

    const ecsSG = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      "ecsSG",
      cdk.Fn.importValue(`${exportPrefix}-EcsSgId`)
    );

    const namespaceArn = cdk.Fn.importValue(`${exportPrefix}-NamespaceArn`);
    const namespaceName = cdk.Fn.importValue(`${exportPrefix}-NamespaceName`);
    const namespace = HttpNamespace.fromHttpNamespaceAttributes(
      this,
      "Namespace",
      {
        namespaceArn: namespaceArn,
        namespaceName: namespaceName,
        namespaceId: "", // Not used but required by interface
      }
    );

    // Build identity details from imported Cognito values
    const identityDetails: IdentityDetails = {
      name: "Cognito",
      details: {
        userPoolId: cdk.Fn.importValue(`${exportPrefix}-UserPoolId`),
        appClientId: cdk.Fn.importValue(`${exportPrefix}-ClientId`),
        issuer: cdk.Fn.importValue(`${exportPrefix}-CognitoIssuer`),
        clientId: cdk.Fn.importValue(`${exportPrefix}-ClientId`),
      },
    };

    const appSiteUrl = props.appSiteUrl || cdk.Fn.importValue("AppSiteUrl");

    // Determine DB type and prepare RDS imports if MySQL
    const useMySQL = process.env.CDK_USE_DB === "mysql";
    let stsRoleArn = "";
    let dbProxyArn = "";
    let proxyName = "";

    if (useMySQL) {
      stsRoleArn = cdk.Fn.importValue("STSRoleArn").toString();
      dbProxyArn = cdk.Fn.importValue("DbProxyArn").toString();
      proxyName = cdk.Fn.select(6, cdk.Fn.split(":", cdk.Fn.importValue("DbProxyArn"))).toString();
    }

    // Read and parse service-info.json with placeholder replacement
    const data = fs.readFileSync(
      path.resolve(__dirname, "../service-info.json"),
      "utf8"
    );
    const replacements: { [key: string]: string } = {
      "<NAMESPACE>": namespaceName.toString(),
      "<APP_SITE_URL>": appSiteUrl.toString(),
    };

    // Add MySQL-specific replacements
    if (useMySQL) {
      replacements["<IAM_ARN>"] = stsRoleArn;
      replacements["<PROXY_ENDPOINT>"] = cdk.Fn.importValue("RdsProxyEndpoint").toString();
      replacements["<CLUSTER_ENDPOINT_RESOURCE>"] =
        `arn:${Aws.PARTITION}:rds-db:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:dbuser:${proxyName}/`;
    }

    let updateData = data;
    for (const [placeholder, replacement] of Object.entries(replacements)) {
      const regex = new RegExp(placeholder, "g");
      updateData = updateData.replace(regex, replacement);
    }

    const serviceInfo = JSON.parse(updateData);
    const containerInfo: ContainerInfo[] = serviceInfo.Containers;

    // Deploy core services
    const coreServices: EcsService[] = [];

    containerInfo.forEach((info) => {
      const storage = this.createStorageIfNeeded(info, props.tenantName);
      const taskRole = this.createTaskRole(
        info,
        storage,
        identityDetails,
        props.tier,
        props.tenantName,
        useMySQL,
        proxyName,
        stsRoleArn
      );

      const ecsService = new EcsService(this, `${info.name}-EcsServices`, {
        tenantId: props.tenantId,
        tenantName: props.tenantName,
        isEc2Tier,
        isRProxy,
        isTarget: !isRProxy,
        vpc: vpc,
        cluster: cluster,
        ecsSG: ecsSG as ec2.SecurityGroup,
        taskRole,
        namespace: namespace as HttpNamespace,
        info,
        identityDetails: identityDetails,
      });

      ecsService.service.node.addDependency(cluster);
      ecsService.service.node.addDependency(vpc);
      coreServices.push(ecsService);
    });

    if (isRProxy) {
      this.deployRProxyService(
        serviceInfo,
        props,
        vpc,
        ecsSG as ec2.SecurityGroup,
        identityDetails,
        cluster,
        namespace as HttpNamespace,
        isEc2Tier,
        isRProxy,
        coreServices
      );
    }

    // MySQL schema provisioning via shared Custom Resource Lambda
    if (useMySQL) {
      const schemeLambdaArn = cdk.Fn.importValue("SchemeLambdaArn");
      const customResourceFnArn = cdk.Fn.importValue('TenantCustomResourceFnArn');

      const shouldExecuteCustomResource = new cdk.CfnCondition(
        this,
        "ShouldExecuteCustomResource",
        {
          expression: cdk.Fn.conditionEquals(process.env.CDK_USE_DB, "mysql"),
        }
      );

      const mysqlCustomResource = new cdk.CustomResource(
        this,
        "InvokeLambdaCustomResource",
        {
          serviceToken: customResourceFnArn,
          properties: {
            Action: 'LambdaInvoke',
            FunctionName: schemeLambdaArn,
            Payload: JSON.stringify({
              tenantName: props.tenantName,
              stackName: cdk.Stack.of(this).stackName,
            }),
          },
        }
      );

      if (
        mysqlCustomResource.node.defaultChild &&
        mysqlCustomResource.node.defaultChild instanceof cdk.CfnResource
      ) {
        (
          mysqlCustomResource.node.defaultChild as cdk.CfnResource
        ).cfnOptions.condition = shouldExecuteCustomResource;
      }
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
        tableName: `${info.environment?.TABLE_NAME.replace(/_/g, "-").toLowerCase()}-${tenantName}`,
        tenantName: tenantName,
      });

      info.environment.TABLE_NAME = storage.table.tableName;
      return storage;
    }
    return undefined;
  }

  /**
   * Create IAM task role for ECS service
   * Handles DynamoDB (ABAC), MySQL (silo/pool), and stateless services
   */
  private createTaskRole(
    info: ContainerInfo,
    storage: EcsDynamoDB | undefined,
    identityDetails: IdentityDetails,
    tier: string,
    tenantName: string,
    useMySQL: boolean,
    proxyName: string,
    stsRoleArn: string
  ): iam.IRole {
    let policy = JSON.stringify(info.policy);

    if (storage) {
      // DynamoDB service — ABAC role pattern
      const taskRole = new iam.Role(this, `${info.name}-ecsTaskRole`, {
        assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AmazonEC2ContainerServiceforEC2Role"
          ),
        ],
      });

      const abacRole = new iam.Role(this, `${info.name}-ABACRole`, {
        assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        inlinePolicies: {
          DynamoDBTenantAccess: storage.policyDocument,
        },
      });

      abacRole.assumeRolePolicy?.addStatements(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          principals: [new iam.ArnPrincipal(taskRole.roleArn)],
          actions: ["sts:AssumeRole", "sts:TagSession"],
          conditions: {
            StringLike: { "aws:RequestTag/tenant": "*" },
          },
        })
      );

      taskRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["sts:AssumeRole", "sts:TagSession"],
          resources: [abacRole.roleArn],
          conditions: {
            StringLike: { "aws:RequestTag/tenant": "*" },
          },
        })
      );

      // TokenVendingMachine environment variables
      info.environment = info.environment || ({} as any);
      info.environment.IAM_ROLE_ARN = abacRole.roleArn;
      info.environment.REQUEST_TAG_KEYS_MAPPING_ATTRIBUTES =
        '{"tenant":"custom:tenantId"}';
      info.environment.IDP_DETAILS = JSON.stringify({
        issuer: identityDetails.details.issuer,
        audience: identityDetails.details.clientId,
      });

      if (policy) {
        // Replace USER_POOL_ID placeholder if present (e.g., fossaadmin)
        policy = policy.replace(
          /<USER_POOL_ID>/g,
          identityDetails.details.userPoolId
        );
        taskRole.attachInlinePolicy(
          new iam.Policy(this, `${info.name}AdditionalPolicy`, {
            document: iam.PolicyDocument.fromJson(JSON.parse(policy)),
          })
        );
      }

      return taskRole;
    } else if (
      info.hasOwnProperty("database") &&
      info.database?.kind === "mysql"
    ) {
      // MySQL service — silo vs pool Task Role
      const isSilo = ["advanced", "premium"].includes(tier.toLowerCase());

      if (isSilo) {
        // Silo tier: dedicated Task Role scoped to this tenant's DB user
        return new iam.Role(this, `${info.name}-ecsTaskRole`, {
          assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
          inlinePolicies: {
            RdsConnect: new iam.PolicyDocument({
              statements: [
                new iam.PolicyStatement({
                  actions: ["rds-db:connect"],
                  resources: [
                    `arn:${Aws.PARTITION}:rds-db:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:dbuser:${proxyName}/user_${tenantName}`,
                  ],
                }),
              ],
            }),
            StsAssumeRole: new iam.PolicyDocument({
              statements: [
                new iam.PolicyStatement({
                  actions: ["sts:AssumeRole"],
                  resources: [stsRoleArn],
                }),
              ],
            }),
          },
          managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName(
              "service-role/AmazonEC2ContainerServiceforEC2Role"
            ),
          ],
        });
      } else {
        // Pool tier (Basic): shared Task Role from RdsCluster
        return iam.Role.fromRoleArn(
          this,
          `${info.name}-ecsTaskRole`,
          cdk.Fn.importValue("TaskRoleArn"),
          { mutable: true }
        );
      }
    } else {
      // Stateless service (e.g., users) — Cognito policy
      policy = policy.replace(
        /<USER_POOL_ID>/g,
        identityDetails.details.userPoolId
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
    props: TenantServiceStackProps,
    vpc: ec2.IVpc,
    ecsSG: ec2.SecurityGroup,
    identityDetails: IdentityDetails,
    cluster: ecs.ICluster,
    namespace: HttpNamespace,
    isEc2Tier: boolean,
    isRProxy: boolean,
    coreServices: EcsService[]
  ): void {
    const rProxyInfo: ContainerInfo = serviceInfo.Rproxy;

    const taskRole = new iam.Role(this, `rProxy-taskRole`, {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy")
    );
    taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchFullAccess")
    );

    const rproxyService = new EcsService(this, `rproxy-EcsServices`, {
      tenantId: props.tenantId,
      tenantName: props.tenantName,
      isEc2Tier,
      isRProxy,
      isTarget: isRProxy,
      vpc: vpc,
      cluster: cluster,
      ecsSG: ecsSG,
      taskRole,
      namespace: namespace,
      info: rProxyInfo,
      identityDetails: identityDetails,
    });

    // rProxy depends on ALL core services
    coreServices.forEach((coreService) => {
      rproxyService.service.node.addDependency(coreService.service);
    });
  }
}
