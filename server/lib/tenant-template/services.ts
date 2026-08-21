import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { HttpNamespace } from 'aws-cdk-lib/aws-servicediscovery';
import { Construct } from 'constructs';
import { getRulePriority } from '../utilities/helper-functions';
import { type ContainerInfo } from '../interfaces/container-info';
import { getServiceName, createTaskDefinition, getContainerDefinitionOptions } from '../utilities/ecs-utils';
import { IdentityDetails } from '../interfaces/identity-details';

export interface EcsServiceProps {
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

  /**
   * API Gateway stage name (e.g. "prod"). Used to auto-inject `BASE_PATH`
   * env var as `/<stage>/<service-name>` so SSR templates and controllers
   * can emit absolute redirect URLs that traverse API Gateway correctly.
   */
  stageName?: string

  /**
   * CloudFront origin used for static asset CDN (SSR services).
   * Auto-injects `CDN_URL=<appSiteUrl>/<service-name>` when provided.
   */
  appSiteUrl?: string
}

export class EcsService extends Construct {
  public readonly service: ecs.FargateService | ecs.Ec2Service;

  constructor (scope: Construct, id: string, props: EcsServiceProps) {
    super(scope, id);

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

    const stack = cdk.Stack.of(scope);
    // Build extra auto-injected env var defaults for this service.
    // Routing envs (BASE_PATH, CDN_URL) are auto-derived from stage + service
    // name so that service-info.txt does NOT need to hardcode them. If a
    // service needs to override (e.g. custom domain), it can still declare
    // the env var in service-info.txt — the spread in getContainerDefinitionOptions
    // gives service-info.txt precedence.
    const routingDefaults: Record<string, string> = {};
    if (props.stageName && !props.isRProxy) {
      // The rproxy container itself does not need BASE_PATH / SERVICE_PATH_PREFIX,
      // but the core services do. Note: `isRProxy` here means "whether the entire
      // architecture is in rproxy mode", NOT "whether this specific EcsService is
      // the rproxy container". The actual container-level check below uses
      // `props.info.name !== 'rproxy'` instead.
    }
    // Inject routing env vars only into core services, not into the rproxy
    // container. rproxy performs path routing at the nginx layer and never
    // consults BASE_PATH.
    if (props.info.name !== 'rproxy') {
      if (props.stageName) {
        routingDefaults.BASE_PATH = `/${props.stageName}/${props.info.name}`;
      }
      if (props.appSiteUrl) {
        routingDefaults.CDN_URL = `${props.appSiteUrl.replace(/\/$/, '')}/${props.info.name}`;
      }
    }

    const containerDef = getContainerDefinitionOptions(
      stack,
      props.info,
      props.identityDetails,
      routingDefaults,
    );
    const taskDefinition = createTaskDefinition(stack, props.isEc2Tier, taskExecutionRole, props.taskRole, containerDef);
    taskDefinition.addContainer( `${props.info.name}-container`, containerDef);

    // const portDns = props.info.portMappings.map((port) => ({
    //   portMappingName: port.name,
    //   dnsName: `${port.name}-api.${props.namespace.namespaceName}.sc`,
    //   port: port.containerPort,
    //   discoveryName: `${port.name}-api`
    // }))

    const serviceProps = {
      cluster: props.cluster,
      desiredCount: 1, // Reduced from 2 to 1 for faster startup
      taskDefinition,
      securityGroups: [props.ecsSG],
      trunking: true,
      minHealthyPercent: 0, // Reduced from 100 to 0 for faster deployment
      maxHealthyPercent: 200,
      enableExecuteCommand: true, // Disable unnecessary features
      placementStrategy: props.isEc2Tier ? [
        ecs.PlacementStrategy.spreadAcrossInstances(),
        ecs.PlacementStrategy.packedByCpu()
      ] : undefined,
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



    this.service = props.isEc2Tier
      ? new ecs.Ec2Service(this, `${props.info.name}-service`, serviceProps)
      : new ecs.FargateService(this, `${props.info.name}-service`, serviceProps);

    getServiceName(this.service.node.defaultChild as ecs.CfnService, props.tenantName, props.info.name);

    if( props.isTarget ) {
      const targetGroupHttp = new elbv2.ApplicationTargetGroup( this, `target-group-${props.info.name}-${props.tenantId}`, {
          vpc: props.vpc,
          port: props.info.containerPort,
          protocol: elbv2.ApplicationProtocol.HTTP,
          targetType: elbv2.TargetType.IP,
          healthCheck: { 
            path: props.isRProxy? '/health': `/${props.info.name}/health`,
            protocol: elbv2.Protocol.HTTP,
// matcher removed - unnecessary as health check always returns 200
          }
        }
      );

      new elbv2.ApplicationListenerRule(this, `Rule-${props.info.name}-${props.tenantId}`, {
        listener: listener,
        priority: getRulePriority(props.tenantId, props.info.name),
        action: elbv2.ListenerAction.forward([targetGroupHttp]),
        conditions: props.isRProxy ?[
          elbv2.ListenerCondition.httpHeader('tenantPath', [props.tenantId]),
        ] : [
          elbv2.ListenerCondition.httpHeader('tenantPath', [props.tenantId]),
          elbv2.ListenerCondition.pathPatterns([`/${props.info.name}*`])
        ]
      });
      this.service.attachToApplicationTargetGroup(targetGroupHttp);
      this.service.connections.allowFrom(listener, ec2.Port.tcp(props.info.containerPort));
    } 

    // Disable service-level auto scaling to prevent conflicts with ECS Managed Scaling
    // ECS Managed Scaling at cluster level handles capacity management
    // if (process.env.ENABLE_SERVICE_AUTOSCALING === 'true') {
    //   const scalableTarget = this.service.autoScaleTaskCount({
    //     minCapacity: 1,
    //     maxCapacity: 3
    //   });
    //
    //   scalableTarget.scaleOnMemoryUtilization('ScaleUpMem', {
    //     targetUtilizationPercent: 80,
    //     scaleInCooldown: cdk.Duration.seconds(60),
    //     scaleOutCooldown: cdk.Duration.seconds(60)
    //   });
    //
    //   scalableTarget.scaleOnCpuUtilization('ScaleUpCPU', {
    //     targetUtilizationPercent: 80,
    //     scaleInCooldown: cdk.Duration.seconds(60),
    //     scaleOutCooldown: cdk.Duration.seconds(60)
    //   });
    // }

  }
}


