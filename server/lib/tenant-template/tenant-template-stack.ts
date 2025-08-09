import * as cdk from 'aws-cdk-lib';
import { Aws } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { type Construct } from 'constructs';
import { type Table } from 'aws-cdk-lib/aws-dynamodb';
import { IdentityProvider } from './identity-provider';
import { EcsCluster } from './ecs-cluster';
import { EcsService } from './services';
import { TenantTemplateNag } from '../cdknag/tenant-template-nag';
import { addTemplateTag } from '../utilities/helper-functions';
import { ContainerInfo } from '../interfaces/container-info';
import { HttpNamespace } from 'aws-cdk-lib/aws-servicediscovery';
import { EcsDynamoDB } from './ecs-dynamodb';
import path = require('path');
import * as fs from 'fs';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId
} from 'aws-cdk-lib/custom-resources';

interface TenantTemplateStackProps extends cdk.StackProps {
  stageName: string
  tenantId: string
  tenantName: string
  tenantMappingTable: Table
  commitId: string
  waveNumber?: string
  tier: string
  advancedCluster: string
  appSiteUrl: string
  useFederation: string
  useEc2?: boolean
  useRProxy?: boolean
}

export class TenantTemplateStack extends cdk.Stack {
  productServiceUri: string;
  orderServiceUri: string;
  cluster: ecs.ICluster;
  namespace: HttpNamespace;
  
  constructor (scope: Construct, id: string, props: TenantTemplateStackProps) {
    super(scope, id, props);
    const waveNumber = props.waveNumber || '1';
    addTemplateTag(this, 'TenantTemplateStack');

    const identityProvider = new IdentityProvider(this, 'IdentityProvider', {
      tenantId: props.tenantId,
      appSiteUrl: props.appSiteUrl,
      useFederation: props.useFederation
    });

    const vpc = ec2.Vpc.fromVpcAttributes(this, 'Vpc', {
      vpcId: cdk.Fn.importValue('EcsVpcId'),
      availabilityZones: cdk.Fn.split(',', cdk.Fn.importValue('AvailabilityZones')),
      privateSubnetIds : cdk.Fn.split(',', cdk.Fn.importValue('PrivateSubnetIds'))
    });

    // SG for ALB to ECS & ECS services's communication
    const ecsSG = new ec2.SecurityGroup(this, 'ecsSG', {
      vpc: vpc,
      allowAllOutbound: true
    });
    
    //=============================
    //| 1. EC2 or Fargate setting |
    //| 2. Reverse Proxy setting  |
    //=============================
    
    // props에서 설정값 가져오기 (기본값: Fargate + rProxy)
    const isEc2Tier: boolean = props.useEc2 ?? false;
    const isRProxy: boolean = props.useRProxy ?? true;

    //=====================================================================
    if('advanced' === props.tier.toLocaleLowerCase() && 'ACTIVE' === props.advancedCluster ) {
      let clusterName = `${props.stageName}-advanced-${cdk.Stack.of(this).account}`
      this.cluster =  ecs.Cluster.fromClusterAttributes(this, 'advanced', {
        clusterName: clusterName,
        vpc: vpc,
        securityGroups: [],
      });
    }
    else {
      const ecsCluster = new EcsCluster(this, 'EcsCluster', {
        vpc: vpc,
        stageName: props.stageName,
        tenantId: props.tenantId,
        tier: props.tier,
        isEc2Tier,
      });
      this.cluster = ecsCluster.cluster;
    }

    if( 'advanced' !== props.tier.toLocaleLowerCase() || 'ACTIVE' === props.advancedCluster) {
      const stsRoleArn = cdk.Fn.importValue('STSRoleArn');
      const dbProxyArn = cdk.Fn.importValue('DbProxyArn');
      const proxyName = cdk.Fn.select(6, cdk.Fn.split(':', dbProxyArn));
      this.namespace = new HttpNamespace(this, 'CloudMapNamespace', {
        name: `${props.tenantName}`,
      });

      const data = fs.readFileSync(path.resolve(__dirname, '../service-info.json'), 'utf8');
      const replacements: { [key: string]: string } = {
        '<IAM_ARN>': stsRoleArn,
        '<PROXY_ENDPOINT>': cdk.Fn.importValue('RdsProxyEndpoint'),
        '<CLUSTER_ENDPOINT_RESOURCE>': `arn:${Aws.PARTITION}:rds-db:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:dbuser:${proxyName}/`,
        '<NAMESPACE>': this.namespace.namespaceName
      }
    
      let updateData = data;
      for(const [placeholder, replacement] of Object.entries(replacements)) {
        const regex = new RegExp(placeholder, 'g');
        updateData = updateData.replace(regex, replacement);
      }
      
      const serviceInfo = JSON.parse(updateData);
      const containerInfo: ContainerInfo[] = serviceInfo.Containers;

      // Deploy core services (orders, products, users) in parallel first
      const coreServices: EcsService[] = [];
      
      containerInfo.forEach((info, index) => {
        let policy = JSON.stringify(info.policy);
        let taskRole = undefined;

        if (info.hasOwnProperty('database')) {
          if(info.database?.kind == 'dynamodb') {//DYNAMODB
            const storage = new EcsDynamoDB(this, `${info.name}Storage`, {
              name: info.name, partitionKey: 'tenantId', sortKey: `${info.database?.sortKey}`,
              tableName: `${info.environment?.TABLE_NAME.replace(/_/g, '-').toLowerCase()}-${props.tenantName}`,
              tenantName: props.tenantName
            });
            taskRole = new iam.Role(this, `${info.name}-ecsTaskRole`, {
              assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
              inlinePolicies: { EcsContainerInlinePolicy: storage.policyDocument },
              managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role')]
            }); 
            
            if(policy) { //additional policy like SSM
              taskRole.attachInlinePolicy( new iam.Policy(this, 'MyPolicy', {
                document: iam.PolicyDocument.fromJson(JSON.parse(policy))
              }));
            }

            info.environment.TABLE_NAME =  storage.table.tableName;  
          } else { //MySQL database per TENANT
            taskRole = iam.Role.fromRoleArn(this, `${info.name}-ecsTaskRole`, cdk.Fn.importValue('TaskRoleArn'), {mutable: true,})
          } 
        } else {
          policy = policy.replace(/<USER_POOL_ID>/g, `${identityProvider.identityDetails.details.userPoolId}`);
          taskRole = new iam.Role(this, `${info.name}-ecsTaskRole`, {
            assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
            inlinePolicies: { EcsContainerInlinePolicy: iam.PolicyDocument.fromJson(JSON.parse(policy)) }
          });
          
        } 

        const ecsService = new EcsService(this, `${info.name}-EcsServices`, {
          tenantId: props.tenantId,
          tenantName: props.tenantName,
          isEc2Tier, isRProxy,
          isTarget: !isRProxy,//(isRProxy==true && isTarget==false) or (isRProxy==false && isTarget==true)
          vpc: vpc, cluster: this.cluster, ecsSG: ecsSG,
          taskRole,    
          namespace: this.namespace,
          info,
          identityDetails: identityProvider.identityDetails
          // env: { account: this.account, region: this.region }
        });
        
        ecsService.service.node.addDependency(this.cluster);
        ecsService.service.node.addDependency(vpc);
        
        // Store core services for rproxy dependency
        coreServices.push(ecsService);
      });

      if (isRProxy ) {
        const rProxyInfo: ContainerInfo = serviceInfo.Rproxy;
        const taskRole = new iam.Role(this, `rProxy-taskRole`, {
          assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        });
    
        taskRole.addManagedPolicy( iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy') );
        taskRole.addManagedPolicy( iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchFullAccess') );

        const rproxyService = new EcsService(this, `rproxy-EcsServices`, {
          tenantId: props.tenantId,
          tenantName: props.tenantName,
          isEc2Tier, isRProxy,
          isTarget: isRProxy, //isRProxy == true && isTarget == true 
          vpc: vpc, cluster: this.cluster, ecsSG: ecsSG,
          taskRole,
          namespace: this.namespace,
          info: rProxyInfo,
          identityDetails: identityProvider.identityDetails
          // env: { account: this.account, region: this.region }
        });
       
        // rproxy depends on ALL core services (orders, products, users)
        coreServices.forEach(coreService => {
          rproxyService.service.node.addDependency(coreService.service);
        });
      } 
    }
    //=====================================================================

    new AwsCustomResource(this, 'CreateTenantMapping', {
      installLatestAwsSdk: true,
      onCreate: {
        service: 'DynamoDB',
        action: 'putItem',
        physicalResourceId: PhysicalResourceId.of('CreateTenantMapping'),
        parameters: {
          TableName: props.tenantMappingTable.tableName,
          Item: {
            tenantId: { S: props.tenantId },
            stackName: { S: cdk.Stack.of(this).stackName },
            codeCommitId: { S: props.commitId },
            waveNumber: { S: waveNumber }
          }
        }
      },
      onUpdate: {
        service: 'DynamoDB',
        action: 'updateItem',
        physicalResourceId: PhysicalResourceId.of('CreateTenantMapping'),
        parameters: {
          TableName: props.tenantMappingTable.tableName,
          Key: {
            tenantId: { S: props.tenantId }
          },
          UpdateExpression: 'set codeCommitId = :codeCommitId',
          ExpressionAttributeValues: {
            ':codeCommitId': { S: props.commitId }
          }
        }
      },
      onDelete: {
        service: 'DynamoDB',
        action: 'deleteItem',
        parameters: {
          TableName: props.tenantMappingTable.tableName,
          Key: {
            tenantId: { S: props.tenantId }
          }
        }
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: [props.tenantMappingTable.tableArn]
      })
    });

    // CDK CustomResource condition setting (based on Environment)
    if(process.env.CDK_USE_DB =='mysql') {
      const shouldExecuteCustomResource = new cdk.CfnCondition(this, 'ShouldExecuteCustomResource', {
        expression: cdk.Fn.conditionEquals(process.env.CDK_USE_DB, 'mysql'),
      });
      const schemeLambdaArn = process.env.CDK_USE_DB =='mysql'? cdk.Fn.importValue('SchemeLambdaArn'):"";

      const mysqlCustomResource = new AwsCustomResource(this, 'InvokeLambdaCustomResource', {
        installLatestAwsSdk: true,
        onCreate: {
          service: 'Lambda',
          action: 'invoke',
          physicalResourceId: PhysicalResourceId.of('InvokeLambdaCustomResource'),
          parameters: {
            FunctionName:  schemeLambdaArn,
            InvocationType: 'Event',
            Payload: JSON.stringify({
              tenantName: props.tenantName,
              stackName: cdk.Stack.of(this).stackName,
            })
          }
        },
      
        policy: AwsCustomResourcePolicy.fromStatements([
          new cdk.aws_iam.PolicyStatement({
            actions: ['lambda:InvokeFunction'],
            resources: [schemeLambdaArn],
          }),
        ]),
      });
      
      if (mysqlCustomResource.node.defaultChild && mysqlCustomResource.node.defaultChild instanceof cdk.CfnResource) {
        (mysqlCustomResource.node.defaultChild as cdk.CfnResource).cfnOptions.condition = shouldExecuteCustomResource;
      } else {
        console.warn('mysqlCustomResource.node.defaultChild is not a CfnResource');
      }
    }

    new cdk.CfnOutput(this, 'TenantUserpoolId', {
      value: identityProvider.tenantUserPool.userPoolId
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: identityProvider.tenantUserPoolClient.userPoolClientId
    });

    new cdk.CfnOutput(this, 'S3SourceVersion', {
      value: props.commitId
    });

    // CDK Nag 체크 (환경변수로 제어)
    if (process.env.CDK_NAG_ENABLED === 'true') {
      new TenantTemplateNag(this, 'TenantInfraNag', {
        tenantId: props.tenantId,
        isEc2Tier,
        tier: props.tier,
        advancedCluster: props.advancedCluster,
        isRProxy
      });
    }

  }
  
}
