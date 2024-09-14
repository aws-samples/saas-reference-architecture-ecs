import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { type Construct } from 'constructs';
import { type Table } from 'aws-cdk-lib/aws-dynamodb';
import { IdentityProvider } from './identity-provider';
import { type ApiKeySSMParameterNames } from '../interfaces/api-key-ssm-parameter-names';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId
} from 'aws-cdk-lib/custom-resources';
import { EcsCluster } from './ecs-cluster';
import { TenantTemplateNag } from '../cdknag/tenant-template-nag';
import { addTemplateTag } from '../utilities/helper-functions';
import { EcsService } from './services';
// import { HttpNamespace } from 'aws-cdk-lib/aws-servicediscovery';

interface TenantTemplateStackProps extends cdk.StackProps {
  stageName: string
  isPooledDeploy: boolean
  ApiKeySSMParameterNames: ApiKeySSMParameterNames
  tenantId: string
  tenantName: string
  tenantMappingTable: Table
  commitId: string
  waveNumber?: string
  tier: string
  advancedCluster: string
  appSiteUrl: string
}

export class TenantTemplateStack extends cdk.Stack {
  productServiceUri: string;
  orderServiceUri: string;
  cluster: ecs.ICluster;
  // namespace: HttpNamespace;

  constructor (scope: Construct, id: string, props: TenantTemplateStackProps) {
    super(scope, id, props);
    const waveNumber = props.waveNumber || '1';
    addTemplateTag(this, 'TenantTemplateStack');

    const identityProvider = new IdentityProvider(this, 'IdentityProvider', {
      tenantId: props.tenantId,
      appSiteUrl: props.appSiteUrl,
    });

    const vpc = ec2.Vpc.fromVpcAttributes(this, 'Vpc', {
      vpcId: cdk.Fn.importValue('EcsVpcId'),
      availabilityZones: cdk.Fn.split(',', cdk.Fn.importValue('AvailabilityZones')),
      privateSubnetIds : cdk.Fn.split(',', cdk.Fn.importValue('PrivateSubnetIds'))
      
    });

    // alb Security Group ID
    const albSGId = cdk.Fn.importValue('AlbSgId');
    // alb Security Group
    const albSG = ec2.SecurityGroup.fromSecurityGroupId(this, 'albSG', albSGId);

    const listener = elbv2.ApplicationListener.fromApplicationListenerAttributes(this, 'ecs-sbt-listener',
      {
        listenerArn: cdk.Fn.importValue('ListenerArn'),
        securityGroup: albSG
      }
    );

    // ECS SG for ALB to ECS communication
    const ecsSG = new ec2.SecurityGroup(this, 'ecsSG', {
      vpc: vpc,
      allowAllOutbound: true
    });
    ecsSG.connections.allowFrom(albSG, ec2.Port.tcp(80), 'Application Load Balancer');
    ecsSG.connections.allowFrom(ecsSG, ec2.Port.tcp(3010), 'Backend Microservices');

    //=====================================================================
    const ec2Tier = ['advanced', 'premium'];
    const isEc2Tier: boolean = ec2Tier.includes(props.tier.toLowerCase());
    const rProxy = ['advanced', 'premium'];
    const isRProxy: boolean = rProxy.includes(props.tier.toLowerCase());

    // const namespace = new HttpNamespace(this, 'CloudMapNamespace', {
    //   name: `ecs-sbt.local-${props.tenantId}-${timeStr}`,
    // });
    
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
        isRProxy,
        env: {
          account: process.env.CDK_DEFAULT_ACCOUNT,
          region: process.env.CDK_DEFAULT_REGION
        }
      });
      this.cluster = ecsCluster.cluster;
    }


    if( 'advanced' !== props.tier.toLocaleLowerCase() || 'ACTIVE' === props.advancedCluster) {
      new EcsService(this, 'EcsServices', {
        stageName: props.stageName,
        tenantId: props.tenantId,
        tenantName: props.tenantName,
        tier: props.tier,
        idpDetails: identityProvider.identityDetails,
        isEc2Tier,
        isRProxy,
        cluster: this.cluster,
        ecsSG: ecsSG,
        vpc: vpc,
        listener: listener,
      }).node.addDependency(this.cluster)
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

    new cdk.CfnOutput(this, 'TenantUserpoolId', {
      value: identityProvider.tenantUserPool.userPoolId
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: identityProvider.tenantUserPoolClient.userPoolClientId
    });

    new cdk.CfnOutput(this, 'S3SourceVersion', {
      value: props.commitId
    });

    new TenantTemplateNag(this, 'TenantInfraNag', {
      tenantId: props.tenantId,
      isEc2Tier,
      tier: props.tier,
      advancedCluster: props.advancedCluster,
      isRProxy
    })


  }
}
