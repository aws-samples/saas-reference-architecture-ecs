import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { AutoScalingGroup } from 'aws-cdk-lib/aws-autoscaling';
import { type Construct } from 'constructs';
import { CustomEniTrunking } from './eni-trunking';
import { addTemplateTag } from '../utilities/helper-functions';

export interface EcsClusterProps extends cdk.NestedStackProps {
  vpc: ec2.IVpc
  stageName: string
  tenantId: string
  tier: string
  isEc2Tier: boolean
  isRProxy: boolean
  env: cdk.Environment
}

export class EcsCluster extends cdk.NestedStack {
  vpc: ec2.IVpc;
  alb: elbv2.ApplicationLoadBalancer;
  albSG: ec2.ISecurityGroup;
  ecsSG: ec2.SecurityGroup;
  listener: elbv2.IApplicationListener;
  isEc2Tier: boolean;
  ecrRepository: string;
  cluster: ecs.ICluster;

  constructor (scope: Construct, id: string, props: EcsClusterProps) {
    super(scope, id, props);
    addTemplateTag(this, 'EcsClusterStack');
    const tenantId = props.tenantId;
    this.isEc2Tier = props.isEc2Tier;
    this.vpc = props.vpc;
    
    let clusterName = `${props.stageName}-${tenantId}`;
    if('advanced' === props.tier.toLocaleLowerCase() ) {
      clusterName = `${props.stageName}-advanced-${cdk.Stack.of(this).account}`
    }
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
}
