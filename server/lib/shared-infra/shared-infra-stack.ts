import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as path from 'path';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import { type Construct } from 'constructs';
import { Stack, type StackProps, type Environment, Tags, CfnOutput, Fn } from 'aws-cdk-lib';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { ApiGateway } from './api-gateway';
import { type ApiKeySSMParameterNames } from '../interfaces/api-key-ssm-parameter-names';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { PythonLayerVersion } from '@aws-cdk/aws-lambda-python-alpha';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as fs from 'fs';
import { ApiMethods } from './api-methods';
import { type ContainerInfo } from '../interfaces/container-info';
import { SharedInfraNag } from '../cdknag/shared-infra-nag';

export interface SharedInfraProps extends StackProps {
  isPooledDeploy: boolean
  ApiKeySSMParameterNames: ApiKeySSMParameterNames
  stageName: string
  env: Environment
}

export class SharedInfraStack extends Stack {
  vpc: ec2.IVpc;
  alb: elbv2.ApplicationLoadBalancer;
  albSG: ec2.ISecurityGroup;
  ecsSG: ec2.SecurityGroup;
  listener: elbv2.ApplicationListener;
  nlbListener: elbv2.NetworkListener;
  apiGateway: ApiGateway;

  constructor (scope: Construct, id: string, props: SharedInfraProps) {
    super(scope, id);
    
    const azs = Fn.getAzs(this.region);

    this.vpc = new ec2.Vpc(this, 'sbt-ecs-vpc', {
      // maxAzs: 3,
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      availabilityZones: [
        Fn.select(0, azs),
        Fn.select(1, azs),
        Fn.select(2, azs),
      ],
      flowLogs: {
        'sbt-ecs-vpcFlowLog': {
          destination: ec2.FlowLogDestination.toCloudWatchLogs(),
          trafficType: ec2.FlowLogTrafficType.ALL
        }
      }
    });
    Tags.of(this.vpc).add('sbt-ecs-vpc', 'true');

    this.vpc.privateSubnets.forEach((subnet, index) => {
      const cfnSubnet = subnet.node.defaultChild as ec2.CfnSubnet;
      cfnSubnet.addPropertyOverride('CidrBlock', `10.0.${index * 64}.0/18`);
    });
    this.vpc.publicSubnets.forEach((subnet, index) => {
      const cfnSubnet = subnet.node.defaultChild as ec2.CfnSubnet;
      cfnSubnet.addPropertyOverride('CidrBlock', `10.0.${192 + index}.0/24`);
    });

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

    this.apiGateway = new ApiGateway(this, 'ApiGateway', {
      tenantId: 'ecs-sbt',
      isPooledDeploy: props.isPooledDeploy,
      lambdaEcsSaaSLayers: lambdaEcsSaaSLayers,
      nlb: nlb,
      apiKeyBasicTier: {
        apiKeyId: this.ssmLookup(props.ApiKeySSMParameterNames.basic.keyId),
        value: this.ssmLookup(props.ApiKeySSMParameterNames.basic.value)
      },
      apiKeyAdvancedTier: {
        apiKeyId: this.ssmLookup(props.ApiKeySSMParameterNames.advanced.keyId),
        value: this.ssmLookup(props.ApiKeySSMParameterNames.advanced.value)
      },
      apiKeyPremiumTier: {
        apiKeyId: this.ssmLookup(props.ApiKeySSMParameterNames.premium.keyId),
        value: this.ssmLookup(props.ApiKeySSMParameterNames.premium.value)
      },
      apiKeyPlatinumTier: {
        apiKeyId: this.ssmLookup(props.ApiKeySSMParameterNames.platinum.keyId),
        value: this.ssmLookup(props.ApiKeySSMParameterNames.platinum.value)
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

    new CfnOutput(this, 'EcsVpcId', {
      value: this.vpc.vpcId,
      exportName: 'EcsVpcId'
    });

    new CfnOutput(this, 'PrivSubId1EcsSbt', {
      value: this.vpc.privateSubnets[0].subnetId,
      exportName: 'PrivSubId1EcsSbt'
    });
    new CfnOutput(this, 'PrivSubId2EcsSbt', {
      value: this.vpc.privateSubnets[1].subnetId,
      exportName: 'PrivSubId2EcsSbt'
    });
    new CfnOutput(this, 'PrivSubId3EcsSbt', {
      value: this.vpc.privateSubnets[2].subnetId,
      exportName: 'PrivSubId3EcsSbt'
    });

    new CfnOutput(this, 'PrivSub1RouteId', {
      value: this.vpc.privateSubnets[0].routeTable.routeTableId,
      exportName: 'PrivSub1RouteId'
    });
    new CfnOutput(this, 'PrivSub2RouteId', {
      value: this.vpc.privateSubnets[1].routeTable.routeTableId,
      exportName: 'PrivSub2RouteId'
    });
    new CfnOutput(this, 'PrivSub3RouteId', {
      value: this.vpc.privateSubnets[2].routeTable.routeTableId,
      exportName: 'PrivSub3RouteId'
    });

    new CfnOutput(this, 'ALBDnsName', {
      value: this.alb.loadBalancerDnsName,
      exportName: 'ALBDnsName'
    });
    new CfnOutput(this, 'ALBArn', {
      value: this.alb.loadBalancerArn,
      exportName: 'ALBArn'
    });

    new CfnOutput(this, 'AlbSgId', {
      value: this.albSG.securityGroupId,
      exportName: 'AlbSgId'
    });

    new CfnOutput(this, 'ListenerArn', {
      value: this.listener.listenerArn,
      exportName: 'ListenerArn'
    });

    new CfnOutput(this, 'ApiGatewayUrl', {
      value: this.apiGateway.restApi.url
    });

    new SharedInfraNag(this, 'SharedInfraNag', { stageName: props.stageName });
  }

  ssmLookup (parameterName: string) {
    return StringParameter.valueForStringParameter(this, parameterName);
  }
}
