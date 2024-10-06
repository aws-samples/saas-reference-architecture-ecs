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
}

export class EcsCluster extends cdk.NestedStack {
  cluster: ecs.ICluster;

  constructor (scope: Construct, id: string, props: EcsClusterProps) {
    super(scope, id, props);
    addTemplateTag(this, 'EcsClusterStack');
    
    let clusterName = 'advanced' === props.tier.toLocaleLowerCase() 
        ? `${props.stageName}-advanced-${cdk.Stack.of(this).account}`
        : `${props.stageName}-${props.tenantId}`;
    
    this.cluster = new ecs.Cluster(this, 'EcsCluster', {
      clusterName,
      vpc: props.vpc,
      containerInsights: true,
    });

    if (props.isEc2Tier) {
      const trunking = new CustomEniTrunking(this, "EniTrunking");

      const autoScalingGroup = new AutoScalingGroup(this, `ecs-autoscaleG-${props.tenantId}`, {
        vpc: props.vpc,
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.M5, ec2.InstanceSize.XLARGE),
        machineImage: ecs.EcsOptimizedImage.amazonLinux2(ecs.AmiHardwareType.STANDARD),
        desiredCapacity: 3, minCapacity: 2, maxCapacity: 5,
        requireImdsv2: true,
        newInstancesProtectedFromScaleIn: false,
        role: trunking.ec2Role,
      });
      autoScalingGroup.role.addManagedPolicy(
        iam.ManagedPolicy.fromAwsManagedPolicyName( 'service-role/AmazonEC2ContainerServiceforEC2Role' )
      );
      autoScalingGroup.scaleOnCpuUtilization('autoscaleCPU', {
        targetUtilizationPercent: 50,
      });
      const capacityProvider = new ecs.AsgCapacityProvider(this, `AsgCapacityProvider-${props.tenantId}`, {
          autoScalingGroup,
          enableManagedTerminationProtection: false // important for offboarding.
        }
      );
      const thisCluster = this.cluster as ecs.Cluster;
      thisCluster.addAsgCapacityProvider(capacityProvider);
    }
   
  }
}
