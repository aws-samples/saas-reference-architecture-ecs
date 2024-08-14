import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as fs from 'fs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { HttpNamespace } from 'aws-cdk-lib/aws-servicediscovery';
import { AutoScalingGroup } from 'aws-cdk-lib/aws-autoscaling';
import { type Construct } from 'constructs';
import { type IdentityDetails } from '../interfaces/identity-details';
import getTimeString, { getHashCode } from '../utilities/helper-functions';
import { type ContainerInfo } from '../interfaces/container-info';
import { type RproxyInfo } from '../interfaces/rproxy-info';
import { CustomEniTrunking } from './eni-trunking';
import { addTemplateTag } from '../utilities/helper-functions';

export interface EcsClusterProps extends cdk.NestedStackProps {
  stageName: string
  tenantId: string
  tier: string
  idpDetails: IdentityDetails
  isEc2Tier: boolean
  isRProxy: boolean
  advancedCluster: string
  env: cdk.Environment
}

export class EcsCluster extends cdk.NestedStack {
  vpc: ec2.IVpc;
  alb: elbv2.ApplicationLoadBalancer;
  albSG: ec2.ISecurityGroup;
  ecsSG: ec2.SecurityGroup;
  listener: elbv2.IApplicationListener;
  namespace: HttpNamespace;
  isEc2Tier: boolean;
  ecrRepository: string;
  cluster: ecs.ICluster;

  constructor (scope: Construct, id: string, props: EcsClusterProps) {
    super(scope, id, props);
    addTemplateTag(this, 'EcsClusterStack');
    const tenantId = props.tenantId;
    const timeStr = getTimeString();
    this.isEc2Tier = props.isEc2Tier;
  
    this.vpc = ec2.Vpc.fromVpcAttributes(this, 'Vpc', {
      vpcId: cdk.Fn.importValue('EcsVpcId'),
      availabilityZones: cdk.Fn.split(',', cdk.Fn.importValue('AvailabilityZones')),
      privateSubnetIds : cdk.Fn.split(',', cdk.Fn.importValue('PrivateSubnetIds'))
      
    });

    // alb Security Group ID
    const albSGId = cdk.Fn.importValue('AlbSgId');

    // Load Balancer
    elbv2.ApplicationLoadBalancer.fromApplicationLoadBalancerAttributes(this, 'sbt-ecs-alb', {
      vpc: this.vpc,
      loadBalancerDnsName: cdk.Fn.importValue('ALBDnsName'),
      loadBalancerArn: cdk.Fn.importValue('ALBArn'),
      securityGroupId: albSGId
    });

    // alb Security Group
    this.albSG = ec2.SecurityGroup.fromSecurityGroupId(this, 'albSG', albSGId);

    this.listener = elbv2.ApplicationListener.fromApplicationListenerAttributes(this, 'ecs-sbt-listener',
      {
        listenerArn: cdk.Fn.importValue('ListenerArn'),
        securityGroup: this.albSG
      }
    );

    // ECS SG for ALB to ECS communication
    this.ecsSG = new ec2.SecurityGroup(this, 'ecsSG', {
      vpc: this.vpc,
      allowAllOutbound: true
    });
    this.ecsSG.connections.allowFrom(this.albSG, ec2.Port.tcp(80), 'Application Load Balancer');
    this.ecsSG.connections.allowFrom(this.ecsSG, ec2.Port.tcp(3010), 'Backend Micrioservice');

    // let clusters: ecs.ICluster|undefined;

    this.cluster = this.getCluster(
      // this.cluster,
      props.tier,
      props.stageName,
    );

    let clusterName = `${props.stageName}-${tenantId}-${timeStr}`;
    if('advanced' === props.tier.toLocaleLowerCase() ) {
      clusterName = `${props.stageName}-advanced-${cdk.Stack.of(this).account}`
    }

    if('advanced' !== props.tier.toLocaleLowerCase() || 'ACTIVE' !== props.advancedCluster ) {  
      this.cluster = new ecs.Cluster(this, 'EcsCluster', {
        clusterName,
        vpc: this.vpc,
        containerInsights: true,
      });
      if (this.isEc2Tier) {
        const trunking = new CustomEniTrunking(this, "EniTrunking");

        const autoScalingGroup = new AutoScalingGroup(this, `ecs-autoscaleG-${tenantId}`, {
          vpc: this.vpc,
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.M5, ec2.InstanceSize.XLARGE),
          machineImage: ecs.EcsOptimizedImage.amazonLinux2(ecs.AmiHardwareType.STANDARD),
          desiredCapacity: 3,
          minCapacity: 2,
          maxCapacity: 5,
          requireImdsv2: true,
          newInstancesProtectedFromScaleIn: false,
          role: trunking.ec2Role,
        });
        autoScalingGroup.role.addManagedPolicy(
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            'service-role/AmazonEC2ContainerServiceforEC2Role'
          )
        );
        autoScalingGroup.scaleOnCpuUtilization('autoscaleCPU', {
          targetUtilizationPercent: 50,
        });
        const capacityProvider = new ecs.AsgCapacityProvider(this, `AsgCapacityProvider-${tenantId}`, {
            autoScalingGroup,
            enableManagedTerminationProtection: false // important for offboarding.
          }
        );
        const thiCluster = this.cluster as ecs.Cluster;
        thiCluster.addAsgCapacityProvider(capacityProvider);
      }
    }  

    this.namespace = new HttpNamespace(this, 'CloudMapNamespace', {
      name: `ecs-sbt.local-${tenantId}`,
    });

    // Read JSON file with container info
    const containerInfoJSON = fs.readFileSync(path.resolve(__dirname, '../service-info.json'));
    const microservicesObj = JSON.parse(containerInfoJSON.toString());
    const containerInfo: ContainerInfo[] = microservicesObj.Containers;

    const info: RproxyInfo = microservicesObj.Rproxy;

    const taskExecutionRole = new iam.Role(this, `ecsTaskExecutionRole-${tenantId}`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
      ]
    });

    let rproxyService: ecs.IService;
    if (props.isRProxy) {
      this.ecrRepository = info.image.split('/')[0];
      rproxyService = this.createRproxyService(
        // this.cluster,
        tenantId,
        info,
        taskExecutionRole,
        props.stageName
      );
    }
    //* ******/> Create ECS services dynamically    <=========
    //* ******/> based on container info JSON file. <=========
    containerInfo.forEach((info, index) => {
      let table = null;
      let policy = JSON.stringify(info.policy);
      if (info.name !== 'users') {
        table = new cdk.aws_dynamodb.Table(this, `${info.tableName}`, {
          billingMode: cdk.aws_dynamodb.BillingMode.PROVISIONED,
          readCapacity: 5,
          writeCapacity: 5,
          partitionKey: {
            name: 'tenantId',
            type: cdk.aws_dynamodb.AttributeType.STRING
          },
          sortKey: {
            name: `${info.sortKey}`,
            type: cdk.aws_dynamodb.AttributeType.STRING
          }
        });
        new cdk.CfnOutput(this, `${info.name}TableName`, {
          value: table.tableName
        });
        policy = policy.replace(/<TABLE_ARN>/g, `${table.tableArn}`);
      } else {
        policy = policy.replace(/<USER_POOL_ID>/g, `${props.idpDetails.details.userPoolId}`);
      }

      const policyDocument = iam.PolicyDocument.fromJson(JSON.parse(policy));

      const taskRole = new iam.Role(this, `${info.name}-ecsTaskRole`, {
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
        inlinePolicies: {
          EcsContainerInlinePolicy: policyDocument
        }
      });

      taskRole.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonEC2ContainerServiceforEC2Role'
        )
      );

      let taskDefinition = null;
      if (this.isEc2Tier) {
        // ec2
        taskDefinition = new ecs.Ec2TaskDefinition(this, `${info.name}-TaskDef`, {
          executionRole: taskExecutionRole,
          taskRole: taskRole,
          networkMode: ecs.NetworkMode.AWS_VPC
        });
      } else {
        // fargate
        taskDefinition = new ecs.FargateTaskDefinition(this, `${info.name}-TaskDef`, {
          memoryLimitMiB: info.memoryLimitMiB,
          cpu: info.cpu,
          executionRole: taskExecutionRole,
          taskRole: taskRole
        });
      }

      taskDefinition.addContainer(`${info.name}-container${index}`, {
        image: ecs.ContainerImage.fromEcrRepository(
          ecr.Repository.fromRepositoryName(this, info.name, info.image.split('/')[1]),
          'latest'
        ),
        memoryLimitMiB: info.memoryLimitMiB,
        cpu: info.cpu,
        portMappings: [
          {
            name: info.name,
            containerPort: info.containerPort,
            appProtocol: ecs.AppProtocol.http,
            protocol: ecs.Protocol.TCP
          }
        ],
        environment: {
          [info.tableName]: table ? table.tableName : '',
          AWS_REGION: cdk.Stack.of(this).region,
          AWS_ACCOUNT_ID: cdk.Stack.of(this).account,
          COGNITO_USER_POOL_ID: props.idpDetails.details.userPoolId,
          COGNITO_CLIENT_ID: props.idpDetails.details.appClientId,
          COGNITO_REGION: cdk.Stack.of(this).region
        },
        logging: ecs.LogDriver.awsLogs({ streamPrefix: 'ecs-container-logs' })
      });

      const serviceProps = {
        cluster: this.cluster,
        desiredCount: 2,
        taskDefinition,
        securityGroups: [this.ecsSG],
        trunking: true,
        serviceConnectConfiguration: {
          logDriver: ecs.LogDrivers.awsLogs({
            streamPrefix: `${info.name}-sc-traffic-`
          }),
          namespace: this.namespace.namespaceArn,//this.cluster.defaultCloudMapNamespace?.namespaceArn,
          services: [
            {
              portMappingName: info.name,
              dnsName: `${info.name}-api.${props.stageName}.sc`,
              port: info.containerPort,
              discoveryName: `${info.name}-api`
            }
          ]
        }
      };

      let service = null;
      if (this.isEc2Tier) {
        service = new ecs.Ec2Service(this, `${info.name}-service`, serviceProps);
      } else {
        service = new ecs.FargateService(this, `${info.name}-service`, serviceProps);
      }

      const alphaNumericTenantId = `${tenantId}`.replace(/[^a-zA-Z0-9]/g, '');
      const cfnService = service.node.defaultChild as ecs.CfnService;
      cfnService.overrideLogicalId(`${info.name}${alphaNumericTenantId}`);
      cfnService.serviceName = `${info.name}${alphaNumericTenantId}`;

      if (props.isRProxy) {
        rproxyService.node.addDependency(service);
      } else {
        const targetGroupHttp = new elbv2.ApplicationTargetGroup(
          this,
          `target-group-${info.name}-${tenantId}`,
          {
            port: info.containerPort,
            vpc: this.vpc,
            protocol: elbv2.ApplicationProtocol.HTTP,
            targetType: elbv2.TargetType.IP,
            healthCheck: {
              path: `/${info.name}/health`,
              protocol: elbv2.Protocol.HTTP
            }
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
      const scalableTaget = service.autoScaleTaskCount({
        minCapacity: 2,
        maxCapacity: 5
      });

      scalableTaget.scaleOnMemoryUtilization('ScaleUpMem', {
        targetUtilizationPercent: 75
      });

      scalableTaget.scaleOnCpuUtilization('ScaleUpCPU', {
        targetUtilizationPercent: 75
      });
    });
    //* ******/> Create ECS services dynamically    <=========
    //* ******/> based on container info JSON file. <=========
  }

  private createRproxyService (
    // cluster: ecs.ICluster,
    tenantId: string,
    info: RproxyInfo,
    taskExecutionRole: iam.Role,
    stageName: string
  ): ecs.IService {
    let rproxyTaskDef = null;
    if (this.isEc2Tier) {
      // ec2
      rproxyTaskDef = new ecs.Ec2TaskDefinition(this, 'rproxy-TaskDef', {
        executionRole: taskExecutionRole,
        networkMode: ecs.NetworkMode.AWS_VPC
      });
    } else {
      // fargate
      rproxyTaskDef = new ecs.FargateTaskDefinition(this, 'rproxy-TaskDef', {
        memoryLimitMiB: 512,
        executionRole: taskExecutionRole
      });
    }

    rproxyTaskDef.addContainer(`${info.name}-nginx`, {
      image: ecs.ContainerImage.fromEcrRepository(
        ecr.Repository.fromRepositoryName(this, info.name, info.image.split('/')[1]),
        'latest'
      ),
      portMappings: [
        {
          name: info.name,
          containerPort: info.containerPort,
          appProtocol: ecs.AppProtocol.http,
          protocol: ecs.Protocol.TCP
        }
      ],
      environment: {
        TENANT_ID: tenantId
      },
      logging: new ecs.AwsLogDriver({ streamPrefix: `rproxy-app-${tenantId}-` }),
      memoryLimitMiB: 320, // limit examples from the official docs
      cpu: 208 // limit examples from the official docs
    });

    const serviceProps = {
      cluster: this.cluster,
      minHealthyPercent: 0, // for zero downtime rolling deployment set desiredcount=2 and minHealty = 50
      desiredCount: 1,
      taskDefinition: rproxyTaskDef,
      securityGroups: [this.ecsSG],

      serviceConnectConfiguration: {
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: `${info.name}-traffic-`
        }),
        namespace: this.namespace.namespaceArn,
        services: [
          {
            portMappingName: info.name,
            dnsName: `${info.name}-api.${stageName}.sc`,
            port: info.containerPort,
            discoveryName: `${info.name}-api`
          }
        ]
      }
    };
    let service = null;
    if (this.isEc2Tier) {
      service = new ecs.Ec2Service(this, `${info.name}-nginx`, serviceProps);
    } else {
      service = new ecs.FargateService(this, `${info.name}-nginx`, serviceProps);
    }

    const alphaNumericTenantId = `${tenantId}`.replace(/[^a-zA-Z0-9]/g, '');
    const cfnService = service.node.defaultChild as ecs.CfnService;
    cfnService.overrideLogicalId(`${info.name}${alphaNumericTenantId}`);
    cfnService.serviceName = `${info.name}${alphaNumericTenantId}`;

    const targetGroupHttp = new elbv2.ApplicationTargetGroup(this, `target-group-${tenantId}`, {
      port: info.containerPort,
      vpc: this.vpc,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/health',
        protocol: elbv2.Protocol.HTTP
      }
    });

    new elbv2.ApplicationListenerRule(this, `Rule-${tenantId}`, {
      listener: this.listener,
      priority: getHashCode(50000),
      action: elbv2.ListenerAction.forward([targetGroupHttp]),
      conditions: [
        elbv2.ListenerCondition.httpHeader('tenantPath', [tenantId])
      ]
    });

    service.attachToApplicationTargetGroup(targetGroupHttp);
    // required so the ALB can reach the health-check endpoint
    service.connections.allowFrom(this.listener, ec2.Port.tcp(info.containerPort));

    rproxyTaskDef.taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy')
    );
    rproxyTaskDef.taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchFullAccess')
    );

    return service;
  }

  private getCluster (
    tier: string,
    stageName: string
  ): ecs.ICluster {
    
    if('advanced' === tier.toLocaleLowerCase() ) {
      let clusterName = `${stageName}-advanced-${cdk.Stack.of(this).account}`
      this.cluster =  ecs.Cluster.fromClusterAttributes(this, 'advanced', {
        clusterName: clusterName,
        vpc: this.vpc,
        securityGroups: [],
      });
    }
  
    return this.cluster;
  }
}
