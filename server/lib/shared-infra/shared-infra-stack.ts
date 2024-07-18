import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as fs from 'fs';
import * as path from 'path';
import { type Construct } from 'constructs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { PythonLayerVersion } from '@aws-cdk/aws-lambda-python-alpha';
import { ApiMethods } from './api-methods';
import { type ContainerInfo } from '../interfaces/container-info';
import { SharedInfraNag } from '../cdknag/shared-infra-nag';
import { ApiGateway } from './api-gateway';
import { type ApiKeySSMParameterNames } from '../interfaces/api-key-ssm-parameter-names';
import { TenantApiKey } from './tenant-api-key';

export interface SharedInfraProps extends cdk.StackProps {
  isPooledDeploy: boolean
  ApiKeySSMParameterNames: ApiKeySSMParameterNames
  apiKeyPlatinumTierParameter: string
  apiKeyPremiumTierParameter: string
  apiKeyAdvancedTierParameter: string
  apiKeyBasicTierParameter: string
  stageName: string
  azCount: number
  env: cdk.Environment
}

export class SharedInfraStack extends cdk.Stack {
  vpc: ec2.IVpc;
  alb: elbv2.ApplicationLoadBalancer;
  albSG: ec2.ISecurityGroup;
  ecsSG: ec2.SecurityGroup;
  listener: elbv2.ApplicationListener;
  nlbListener: elbv2.NetworkListener;
  apiGateway: ApiGateway;

  constructor (scope: Construct, id: string, props: SharedInfraProps) {
    super(scope, id);

    const azs = cdk.Fn.getAzs(this.region);
    // 스택의 리전에 있는 모든 가용 영역 목록 가져오기

    const selectedAzs = Array(props.azCount).fill('').map(() => '');

    for (let i = 0; i < props.azCount; i++) {
      selectedAzs[i] = cdk.Fn.select(i, azs);
    }

    this.vpc = new ec2.Vpc(this, 'sbt-ecs-vpc', {
      // maxAzs: props.azCount,
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      availabilityZones: selectedAzs,

      flowLogs: {
        'sbt-ecs-vpcFlowLog': {
          destination: ec2.FlowLogDestination.toCloudWatchLogs(),
          trafficType: ec2.FlowLogTrafficType.ALL
        }
      }
    });
    cdk.Tags.of(this.vpc).add('sbt-ecs-vpc', 'true');

    this.vpc.privateSubnets.forEach((subnet, index) => {
      const cfnSubnet = subnet.node.defaultChild as ec2.CfnSubnet;
      cfnSubnet.addPropertyOverride('CidrBlock', `10.0.${index * 64}.0/18`);
    });
    this.vpc.publicSubnets.forEach((subnet, index) => {
      const cfnSubnet = subnet.node.defaultChild as ec2.CfnSubnet;
      cfnSubnet.addPropertyOverride('CidrBlock', `10.0.${192 + index}.0/24`);
    });

    new cdk.CfnOutput(this, 'PrivateSubnetIds', { value: this.vpc.privateSubnets.map(subnet => subnet.subnetId).join(','), exportName: 'PrivateSubnetIds' });
    new cdk.CfnOutput(this, 'AvailabilityZones', { value: selectedAzs.join(','), exportName:'AvailabilityZones' });

    // use a security group to provide a secure connection between the ALB and the containers
    this.albSG = new ec2.SecurityGroup(this, 'alb-sg', {
      vpc: this.vpc,
      allowAllOutbound: true
    });

    this.albSG.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(80),
      'Allow https traffic'
    );

    // ALB Creation
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'sbt-ecs-alb', {
      vpc: this.vpc,
      internetFacing: false,
      securityGroup: this.albSG,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      }
    });

    this.listener = this.alb.addListener('alb-listener', {
      open: true,
      port: 80
    });

    const nlb = new elbv2.NetworkLoadBalancer(this, 'sbt-ecs-nlb', {
      vpc: this.vpc,
      internetFacing: false,
      crossZoneEnabled: true,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      }
    });

    this.nlbListener = nlb.addListener('nlb-listener', {
      port: 80
    });

    const nlbTargetGroup = this.nlbListener.addTargets('nlb-targets', {
      targets: [new targets.AlbTarget(this.alb, 80)],
      port: 80,
      healthCheck: {
        protocol: elbv2.Protocol.HTTP
      }
    });

    nlbTargetGroup.node.addDependency(this.listener);

    const targetGroupHttp = new elbv2.ApplicationTargetGroup(this, 'alb-tg', {
      port: 80,
      vpc: this.vpc,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP
    });

    this.listener.addTargetGroups('alb-listener-tg', {
      targetGroups: [targetGroupHttp]
    });

    const lambdaEcsSaaSLayers = new PythonLayerVersion(this, 'LambdaEcsSaaSLayers', {
      entry: path.join(__dirname, './layers'),
      compatibleRuntimes: [Runtime.PYTHON_3_10]
    });

    const basicKey = new TenantApiKey(this, 'BasicTierApiKey', {
      apiKeyValue: props.apiKeyBasicTierParameter,
      ssmParameterApiKeyIdName: props.ApiKeySSMParameterNames.basic.keyId,
      ssmParameterApiValueName: props.ApiKeySSMParameterNames.basic.value
    });

    const advanceKey = new TenantApiKey(this, 'AdvancedTierApiKey', {
      apiKeyValue: props.apiKeyAdvancedTierParameter,
      ssmParameterApiKeyIdName: props.ApiKeySSMParameterNames.advanced.keyId,
      ssmParameterApiValueName: props.ApiKeySSMParameterNames.advanced.value
    });

    const premiumKey = new TenantApiKey(this, 'PremiumTierApiKey', {
      apiKeyValue: props.apiKeyPremiumTierParameter,
      ssmParameterApiKeyIdName: props.ApiKeySSMParameterNames.premium.keyId,
      ssmParameterApiValueName: props.ApiKeySSMParameterNames.premium.value
    });

    const platinumKey = new TenantApiKey(this, 'PlatinumTierApiKey', {
      apiKeyValue: props.apiKeyPlatinumTierParameter,
      ssmParameterApiKeyIdName: props.ApiKeySSMParameterNames.platinum.keyId,
      ssmParameterApiValueName: props.ApiKeySSMParameterNames.platinum.value
    });

    this.apiGateway = new ApiGateway(this, 'ApiGateway', {
      tenantId: 'ecs-sbt',
      isPooledDeploy: props.isPooledDeploy,
      lambdaEcsSaaSLayers: lambdaEcsSaaSLayers,
      nlb: nlb,
      apiKeyBasicTier: {
        apiKeyId: basicKey.apiKey.keyId,
        value: basicKey.apiKeyValue
      },
      apiKeyAdvancedTier: {
        apiKeyId: advanceKey.apiKey.keyId,
        value: advanceKey.apiKeyValue
      },
      apiKeyPremiumTier: {
        apiKeyId: premiumKey.apiKey.keyId,
        value: premiumKey.apiKeyValue
      },
      apiKeyPlatinumTier: {
        apiKeyId: platinumKey.apiKey.keyId,
        value: platinumKey.apiKeyValue
      },
      stageName: props.stageName
    });

    const vpcLink = new apigateway.VpcLink(this, 'ecs-vpc-link', {
      targets: [nlb]
    });

    // Read JSON file with container info
    const containerInfoJSON = fs.readFileSync(path.resolve(__dirname, '../service-info.json'));
    const containerInfo: ContainerInfo[] = JSON.parse(containerInfoJSON.toString()).Containers;

    containerInfo.forEach((info, _index) => {
      new ApiMethods(this, `${info.name}-ApiMethods`, {
        serviceName: info.name,
        apiGateway: this.apiGateway,
        nlb: nlb,
        vpcLink: vpcLink
      });
    });

    new cdk.CfnOutput(this, 'EcsVpcId', {
      value: this.vpc.vpcId,
      exportName: 'EcsVpcId'
    });

    this.vpc.privateSubnets.forEach((subnet, index) => {
      new cdk.CfnOutput(this, `PrivSub${index+1}RouteId`, {
        value: subnet.routeTable.routeTableId,
        exportName: `PrivSub${index+1}RouteId`,
        description: `Private Subnet ${index+1} Router ID`,
      });
    });

    new cdk.CfnOutput(this, 'ALBDnsName', {
      value: this.alb.loadBalancerDnsName,
      exportName: 'ALBDnsName'
    });
    new cdk.CfnOutput(this, 'ALBArn', {
      value: this.alb.loadBalancerArn,
      exportName: 'ALBArn'
    });

    new cdk.CfnOutput(this, 'AlbSgId', {
      value: this.albSG.securityGroupId,
      exportName: 'AlbSgId'
    });

    new cdk.CfnOutput(this, 'ListenerArn', {
      value: this.listener.listenerArn,
      exportName: 'ListenerArn'
    });

    new cdk.CfnOutput(this, 'ApiGatewayUrl', {
      value: this.apiGateway.restApi.url
    });

    new SharedInfraNag(this, 'SharedInfraNag', { stageName: props.stageName });
  }

  ssmLookup (parameterName: string) {
    return StringParameter.valueForStringParameter(this, parameterName);
  }
}
