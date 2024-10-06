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
import { TenantServiceNag } from '../cdknag/tenant-service-nag';
import { getServiceName, createTaskDefinition } from '../utilities/ecs-utils';

export interface EcsServiceProps extends cdk.NestedStackProps {
  tenantId: string
  tenantName: string
  isEc2Tier: boolean
  isRProxy: boolean
  isTarget: boolean
  vpc: ec2.IVpc
  cluster: ecs.ICluster
  ecsSG: ec2.SecurityGroup 
  listener: elbv2.IApplicationListener
  taskRole?: iam.IRole 

  namespace: HttpNamespace
  info: ContainerInfo
  containerDef: ecs.ContainerDefinitionOptions
  // serviceProps: ecs.FargateServiceProps
  // env: cdk.Environment
}

export class EcsService extends cdk.NestedStack {
  vpc: ec2.IVpc;
  listener: elbv2.IApplicationListener;
  ecsSG: ec2.SecurityGroup;
  isEc2Tier: boolean;
  ecrRepository: string;
  cluster: ecs.ICluster;

  constructor (scope: Construct, id: string, props: EcsServiceProps) {
    super(scope, id, props);
    addTemplateTag(this, 'EcsClusterStack');

    const taskExecutionRole = new iam.Role(this, `ecsTaskExecutionRole-${props.tenantId}`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
      ]
    })

    const taskDefinition = createTaskDefinition(this, props.isEc2Tier, taskExecutionRole, props.taskRole, `${props.info.name}-TaskDef`);
    taskDefinition.addContainer( `${props.info.name}-container`, props.containerDef);

    const serviceProps = {
      cluster: props.cluster,
      desiredCount: 2,
      taskDefinition,
      securityGroups: [props.ecsSG],
      trunking: true,
      serviceConnectConfiguration: {
        namespace: props.namespace.namespaceArn,
        services: [{
            portMappingName: props.info.name,
            dnsName: `${props.info.name}-api.${props.namespace.namespaceName}.sc`, //THIS IS DNS CALLED FROM NGINX
            port: props.info.containerPort,
            discoveryName: `${props.info.name}-api`
        }],
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
        listener: props.listener,
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
      service.connections.allowFrom(props.listener, ec2.Port.tcp(props.info.containerPort));
    } 

    // Autoscaling based on memory and CPU usage
    const scalableTarget = service.autoScaleTaskCount({
      minCapacity: 2, maxCapacity: 5
    });

    scalableTarget.scaleOnMemoryUtilization('ScaleUpMem', {
      targetUtilizationPercent: 75
    });

    scalableTarget.scaleOnCpuUtilization('ScaleUpCPU', {
      targetUtilizationPercent: 75
    });

  }
}


