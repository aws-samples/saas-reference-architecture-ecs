import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as fs from 'fs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { HttpNamespace } from 'aws-cdk-lib/aws-servicediscovery';
import { type Construct } from 'constructs';
import { type IdentityDetails } from '../interfaces/identity-details';
import { getHashCode } from '../utilities/helper-functions';
import { type ContainerInfo } from '../interfaces/container-info';
import { type RproxyInfo } from '../interfaces/rproxy-info';
import { addTemplateTag } from '../utilities/helper-functions';
import { TenantServiceNag } from '../cdknag/tenant-service-nag';
import { Storage } from './storage';
import { getServiceName, createTaskDefinition } from '../utilities/ecs-utils';

export interface EcsServiceProps extends cdk.NestedStackProps {
  tenantId: string
  tenantName: string
  tier: string
  idpDetails: IdentityDetails
  isEc2Tier: boolean
  isRProxy: boolean
  cluster: ecs.ICluster
  ecsSG: ec2.SecurityGroup 
  vpc: ec2.IVpc;
  listener: elbv2.IApplicationListener;
}

export class EcsService extends cdk.NestedStack {
  vpc: ec2.IVpc;
  listener: elbv2.IApplicationListener;
  ecsSG: ec2.SecurityGroup;
  namespace: HttpNamespace;
  isEc2Tier: boolean;
  ecrRepository: string;
  cluster: ecs.ICluster;
  storage: Storage;

  constructor (scope: Construct, id: string, props: EcsServiceProps) {
    super(scope, id, props);
    addTemplateTag(this, 'EcsClusterStack');
    const tenantId = props.tenantId;
    const tenantName = props.tenantName;
    this.isEc2Tier = props.isEc2Tier;
    this.ecsSG = props.ecsSG;
    this.vpc = props.vpc;
    this.listener = props.listener;

    this.namespace = new HttpNamespace(this, 'CloudMapNamespace', {
      name: `${tenantName}`,
    });

    // Read JSON file with container info
    const containerInfoJSON = fs.readFileSync(path.resolve(__dirname, '../service-info.json'));
    const microservicesObj = JSON.parse(containerInfoJSON.toString());
    const containerInfo: ContainerInfo[] = microservicesObj.Containers;

    const rProxyInfo: RproxyInfo = microservicesObj.Rproxy;

    const taskExecutionRole = new iam.Role(this, `ecsTaskExecutionRole-${tenantId}`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
      ]
    });

    const rproxyService = props.isRProxy 
      ? this.createRproxyService( props.cluster, tenantId, tenantName, rProxyInfo, taskExecutionRole)
      : null;

    //* ******/> Create ECS services dynamically    <=========
    //* ******/> based on container info JSON file. <=========
    containerInfo.forEach((info, index) => {
      let policy = JSON.stringify(info.policy);
      if (info.hasOwnProperty('tableName')) {
        this.storage = new Storage(this, `${info.name}Storage`, {
          name: info.name, partitionKey: 'tenantId', sortKey: `${info.sortKey}`,
          tableName: `${info.tableName.replace(/_/g, '-').toLowerCase()}-${props.tenantName}`,
        });
        policy = policy.replace(/<TABLE_ARN>/g, `${this.storage.tableArn}`);
      } else {
        policy = policy.replace(/<USER_POOL_ID>/g, `${props.idpDetails.details.userPoolId}`);
      }
      const policyDocument = iam.PolicyDocument.fromJson(JSON.parse(policy));
      const taskRole = new iam.Role(this, `${info.name}-ecsTaskRole`, {
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        inlinePolicies: { EcsContainerInlinePolicy: policyDocument }
      });
      taskRole.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role')
      );

      const taskDefinition = createTaskDefinition(this, this.isEc2Tier, taskExecutionRole, taskRole, `${info.name}-TaskDef`);

      taskDefinition.addContainer(`${info.name}-container${index}`, {
        image: ecs.ContainerImage.fromEcrRepository( ecr.Repository.fromRepositoryName(this, info.name, info.image.split('/')[1]), 'latest' ),
        memoryLimitMiB: info.memoryLimitMiB, cpu: info.cpu,
        portMappings: [{
            name: info.name, containerPort: info.containerPort,
            appProtocol: ecs.AppProtocol.http,protocol: ecs.Protocol.TCP
        }],
        environment: {
          [info.tableName]: this.storage.table ? this.storage.table.tableName : '',
          AWS_REGION: cdk.Stack.of(this).region,
          AWS_ACCOUNT_ID: cdk.Stack.of(this).account,
          COGNITO_USER_POOL_ID: props.idpDetails.details.userPoolId,
          COGNITO_CLIENT_ID: props.idpDetails.details.appClientId,
          COGNITO_REGION: cdk.Stack.of(this).region
        },
        logging: ecs.LogDriver.awsLogs({ streamPrefix: 'ecs-container-logs' })
      });

      const serviceProps = {
        cluster: props.cluster,
        desiredCount: 2,
        taskDefinition,
        securityGroups: [this.ecsSG],
        trunking: true,
        serviceConnectConfiguration: {
          namespace: this.namespace.namespaceArn,
          services: [{
              portMappingName: info.name,
              dnsName: `${info.name}-api.${this.namespace.namespaceName}.sc`, //THIS IS DNS CALLED FROM NGINX
              port: info.containerPort,
              discoveryName: `${info.name}-api`
          }],
          logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: `${info.name}-sc-traffic-`}),
        }
      };

      const service = this.isEc2Tier
        ? new ecs.Ec2Service(this, `${info.name}-service`, serviceProps)
        : new ecs.FargateService(this, `${info.name}-service`, serviceProps);

      getServiceName(service.node.defaultChild as ecs.CfnService, props.tenantName, info.name);

      if (props.isRProxy && rproxyService != null) {
        rproxyService.node.addDependency(service);
      } else {
        const targetGroupHttp = new elbv2.ApplicationTargetGroup( this, `target-group-${info.name}-${tenantId}`,
          {
            vpc: this.vpc,
            port: info.containerPort,
            protocol: elbv2.ApplicationProtocol.HTTP,
            targetType: elbv2.TargetType.IP,
            healthCheck: { path: `/${info.name}/health`,protocol: elbv2.Protocol.HTTP }
          }
        );

        new elbv2.ApplicationListenerRule(this, `Rule-${info.name}-${tenantId}`, {
          listener: this.listener,
          priority: getHashCode(50000),
          action: elbv2.ListenerAction.forward([targetGroupHttp]),
          conditions: [
            elbv2.ListenerCondition.httpHeader('tenantPath', [tenantId]),
            elbv2.ListenerCondition.pathPatterns([`/${info.name}*`])
          ]
        });

        service.attachToApplicationTargetGroup(targetGroupHttp);
        service.connections.allowFrom(this.listener, ec2.Port.tcp(info.containerPort));
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
    });
    //* ******/> Create ECS services dynamically    <=========
    //* ******/> based on container info JSON file. <=========

    new TenantServiceNag(this, 'TenantInfraNag', {
      tenantId: props.tenantId, isEc2Tier: props.isEc2Tier,
      tier: props.tier, isRProxy: props.isRProxy
    })
  }

  /**==> Reverse Proxy Creation <==**/
  private createRproxyService (
    cluster: ecs.ICluster, tenantId: string,
    tenantName: string, rInfo: RproxyInfo,
    taskExecutionRole: iam.Role
  ): ecs.IService {

    const taskRole = new iam.Role(this, `rProxy-taskRole`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    taskRole.addManagedPolicy( iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy') );
    taskRole.addManagedPolicy( iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchFullAccess') );

    const rproxyTaskDef = createTaskDefinition(this, this.isEc2Tier, taskExecutionRole, taskRole, 'rproxy-TaskDef');

    rproxyTaskDef.addContainer(`${rInfo.name}-nginx`, {
      image: ecs.ContainerImage.fromEcrRepository( ecr.Repository.fromRepositoryName(this, rInfo.name, rInfo.image.split('/')[1]), 'latest' ),
      memoryLimitMiB: rInfo.memoryLimitMiB , cpu: rInfo.cpu, 
      portMappings: [{
        name: rInfo.name, containerPort: rInfo.containerPort,
        appProtocol: ecs.AppProtocol.http, protocol: ecs.Protocol.TCP
      }],
      environment: { TENANT_ID: tenantId, NAMESPACE: this.namespace.namespaceName },
      logging: new ecs.AwsLogDriver({ streamPrefix: `rproxy-app-${tenantId}-` }),
    });

    const serviceProps = {
      cluster,
      minHealthyPercent: 0, desiredCount: 1,//for zero downtime rolling deployment set desiredcount=2, minHealty=50
      taskDefinition: rproxyTaskDef,
      securityGroups: [this.ecsSG],
      serviceConnectConfiguration: {
        namespace: this.namespace.namespaceArn,
        services: [ { 
            portMappingName: rInfo.name, dnsName: `${rInfo.name}-api.prod.sc`,
            port: rInfo.containerPort, discoveryName: `${rInfo.name}-api`
        }],
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: `${rInfo.name}-traffic-`}),
      }
    };

    const service = this.isEc2Tier
        ? new ecs.Ec2Service(this, `${rInfo.name}-nginx`, serviceProps)
        : new ecs.FargateService(this, `${rInfo.name}-nginx`, serviceProps);

    getServiceName(service.node.defaultChild as ecs.CfnService, tenantName, rInfo.name);

    const targetGroupHttp = new elbv2.ApplicationTargetGroup(this, `target-group-${tenantId}`, {
      vpc: this.vpc,
      port: rInfo.containerPort,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: { path: '/health', protocol: elbv2.Protocol.HTTP }
    });

    new elbv2.ApplicationListenerRule(this, `Rule-${tenantId}`, {
      listener: this.listener,
      priority: getHashCode(50000),
      action: elbv2.ListenerAction.forward([targetGroupHttp]),
      conditions: [ elbv2.ListenerCondition.httpHeader('tenantPath', [tenantId]) ]
    });

    service.attachToApplicationTargetGroup(targetGroupHttp);
    // required so the ALB can reach the health-check endpoint
    service.connections.allowFrom(this.listener, ec2.Port.tcp(rInfo.containerPort));

    return service;
  }
}


