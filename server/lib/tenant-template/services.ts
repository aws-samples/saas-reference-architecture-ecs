import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { HttpNamespace } from 'aws-cdk-lib/aws-servicediscovery';
import { type Construct } from 'constructs';
import { getHashCode } from '../utilities/helper-functions';
import { type ContainerInfo } from '../interfaces/container-info';
import { addTemplateTag } from '../utilities/helper-functions';
import { getServiceName, createTaskDefinition, getContainerDefinitionOptions } from '../utilities/ecs-utils';
import { IdentityDetails } from '../interfaces/identity-details';

export interface EcsServiceProps extends cdk.NestedStackProps {
  tenantId: string
  tenantName: string
  isEc2Tier: boolean
  isRProxy: boolean
  isTarget: boolean
  vpc: ec2.IVpc
  cluster: ecs.ICluster
  ecsSG: ec2.SecurityGroup 
  taskRole?: iam.IRole 

  namespace: HttpNamespace
  info: ContainerInfo
  identityDetails: IdentityDetails
  // env: cdk.Environment
}

export class EcsService extends cdk.NestedStack {

  constructor (scope: Construct, id: string, props: EcsServiceProps) {
    super(scope, id, props);
    addTemplateTag(this, 'EcsClusterStack');

    const albSGId = cdk.Fn.importValue('AlbSgId'); // ALB Security Group ID
    const albSG = ec2.SecurityGroup.fromSecurityGroupId(this, 'albSG', albSGId);  // ALB Security Group

    const listener = elbv2.ApplicationListener.fromApplicationListenerAttributes(this, 'ecs-sbt-listener',
      {
        listenerArn: cdk.Fn.importValue('ListenerArn'),
        securityGroup: albSG
      }
    );

    if(props.isRProxy == true && props.isTarget == true){
      props.ecsSG.connections.allowFrom(albSG, ec2.Port.tcp(props.info.containerPort), `ALB to RProxy interface`);
    } else {
      props.ecsSG.connections.allowFrom(props.ecsSG, ec2.Port.tcp(props.info.containerPort), `Add ${props.info.name} Port into backend Security Group`);
    }

    const taskExecutionRole = new iam.Role(this, `ecsTaskExecutionRole-${props.tenantId}`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
      ]
    })

    const containerDef = getContainerDefinitionOptions(this, props.info, props.identityDetails);
    const taskDefinition = createTaskDefinition(this, props.isEc2Tier, taskExecutionRole, props.taskRole, containerDef);
    taskDefinition.addContainer( `${props.info.name}-container`, containerDef);

    // const portDns = props.info.portMappings.map((port) => ({
    //   portMappingName: port.name,
    //   dnsName: `${port.name}-api.${props.namespace.namespaceName}.sc`,
    //   port: port.containerPort,
    //   discoveryName: `${port.name}-api`
    // }))

    const serviceProps = {
      cluster: props.cluster,
      desiredCount: 1, // 2 → 1로 감소 (빠른 시작)
      taskDefinition,
      securityGroups: [props.ecsSG],
      trunking: true,
      minHealthyPercent: 0, // 100 → 0 (더 빠른 배포)
      maxHealthyPercent: 200,
      enableExecuteCommand: false, // 불필요한 기능 비활성화
      serviceConnectConfiguration: {
        namespace: props.namespace.namespaceArn,
        services: props.info.portMappings.map((port) => ({
          portMappingName: port.name,
          dnsName: `${port.name}-api.${props.namespace.namespaceName}.sc`,
          port: port.containerPort,
          discoveryName: `${port.name}-api`
        })),
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: `${props.info.name}-sc-traffic-`}),
      }
    };

    const service = props.isEc2Tier
      ? new ecs.Ec2Service(this, `${props.info.name}-service`, serviceProps)
      : new ecs.FargateService(this, `${props.info.name}-service`, serviceProps);

    getServiceName(service.node.defaultChild as ecs.CfnService, props.tenantName, props.info.name);

    if( props.isTarget ) {
      const targetGroupHttp = new elbv2.ApplicationTargetGroup( this, `target-group-${props.info.name}-${props.tenantId}`, {
          vpc: props.vpc,
          port: props.info.containerPort,
          protocol: elbv2.ApplicationProtocol.HTTP,
          targetType: elbv2.TargetType.IP,
          healthCheck: { 
            path: props.isRProxy? '/health': `/${props.info.name}/health`,
            protocol: elbv2.Protocol.HTTP 
          }
        }
      );

      new elbv2.ApplicationListenerRule(this, `Rule-${props.info.name}-${props.tenantId}`, {
        listener: listener,
        priority: getHashCode(50000),
        action: elbv2.ListenerAction.forward([targetGroupHttp]),
        conditions: props.isRProxy ?[
          elbv2.ListenerCondition.httpHeader('tenantPath', [props.tenantId]),
        ] : [
          elbv2.ListenerCondition.httpHeader('tenantPath', [props.tenantId]),
          elbv2.ListenerCondition.pathPatterns([`/${props.info.name}*`])
        ]
      });
      service.attachToApplicationTargetGroup(targetGroupHttp);
      service.connections.allowFrom(listener, ec2.Port.tcp(props.info.containerPort));
    } 

    // Optimized autoscaling for faster startup
    const scalableTarget = service.autoScaleTaskCount({
      minCapacity: 1, // 2 → 1로 감소
      maxCapacity: 3  // 5 → 3으로 감소
    });

    scalableTarget.scaleOnMemoryUtilization('ScaleUpMem', {
      targetUtilizationPercent: 80, // 75 → 80 (덜 민감하게)
      scaleInCooldown: cdk.Duration.seconds(60), // 빠른 스케일 인
      scaleOutCooldown: cdk.Duration.seconds(60) // 빠른 스케일 아웃
    });

    scalableTarget.scaleOnCpuUtilization('ScaleUpCPU', {
      targetUtilizationPercent: 80, // 75 → 80 (덜 민감하게)
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(60)
    });

  }
}


