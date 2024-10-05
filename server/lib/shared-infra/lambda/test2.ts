import * as cdk from 'aws-cdk-lib';
import { Stack, StackProps } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';

export interface MultiTenantRDSStackProps extends StackProps {
  vpcId: string;
  privateSubnet1: string;
  privateSubnet2: string;
  layerVersionArn: string;
  endpoint: string;
  rdsSecurityGroupId: string;
  createRdsProxy: boolean;
  dbSecretArn: string;
  dbProxyName: string;
  dbProxyArn: string;
  proxySecurityGroupId: string;
  usersToCreate: number;
}

export class MultiTenantRDSStack extends Stack {
  constructor(scope: Construct, id: string, props: MultiTenantRDSStackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromVpcAttributes(this, 'Vpc', {
      vpcId: props.vpcId,
      availabilityZones: this.availabilityZones,
      privateSubnetIds: [props.privateSubnet1, props.privateSubnet2]
    });

    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      description: 'Lambda Security Group',
      allowAllOutbound: true,
    });

    lambdaSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow outbound HTTPS traffic');
    lambdaSecurityGroup.addEgressRule(ec2.SecurityGroup.fromSecurityGroupId(this, 'RDSSecurityGroup', props.rdsSecurityGroupId), ec2.Port.tcp(3306), 'Allow DB outbound traffic');

    const lambdaToRDSIngress = new ec2.CfnSecurityGroupIngress(this, 'LambdaToRDSIngress', {
      ipProtocol: 'tcp',
      fromPort: 3306,
      toPort: 3306,
      groupId: props.rdsSecurityGroupId,
      sourceSecurityGroupId: lambdaSecurityGroup.securityGroupId,
    });


      new ec2.CfnSecurityGroupIngress(this, 'LambdaToProxyIngress', {
        ipProtocol: 'tcp',
        fromPort: 3306,
        toPort: 3306,
        groupId: props.proxySecurityGroupId,
        sourceSecurityGroupId: lambdaSecurityGroup.securityGroupId,
      });


    const lambdaRole = new iam.Role(this, 'LambdaAddUsersRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    lambdaRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));

    const xrayPolicy = new iam.ManagedPolicy(this, 'XrayServiceAccessPolicy', {
      description: `Allows Lambda Function to access X-Ray.`,
      statements: [
        new iam.PolicyStatement({
          actions: [
            'xray:PutTraceSegments',
            'xray:PutTelemetryRecords',
            'xray:GetSamplingRules',
            'xray:GetSamplingTargets',
            'xray:GetSamplingStatisticSummaries'
          ],
          resources: ['*'],
        }),
      ],
    });

    const cloudWatchLogsPolicy = new iam.ManagedPolicy(this, 'CloudWatchLogsServiceAccessPolicy', {
      description: `Allows Lambda Function to access CloudWatch logs.`,
      statements: [
        new iam.PolicyStatement({
          actions: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents'
          ],
          resources: [
            `arn:aws:logs:${this.region}:${this.account}:log-group:*`,
            `arn:aws:logs:${this.region}:${this.account}:log-group:*:log-stream:*`
          ],
        }),
      ],
    });

    const vpcPolicy = new iam.ManagedPolicy(this, 'VPCServiceAccessPolicy', {
      description: `Allows Lambda Function to create and delete network interfaces.`,
      statements: [
        new iam.PolicyStatement({
          actions: ['ec2:DescribeNetworkInterfaces'],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          actions: [
            'ec2:CreateNetworkInterface',
            'ec2:DeleteNetworkInterface',
            'ec2:AssignPrivateIpAddresses',
            'ec2:UnassignPrivateIpAddresses',
          ],
          resources: ['*'],
        }),
      ],
    });

    const secretManagerPolicy = new iam.ManagedPolicy(this, 'SecretsManagerServiceAccessPolicy', {
      description: `Allows Lambda Function to access and manage Secrets Manager secrets.`,
      statements: [
        new iam.PolicyStatement({
          actions: ['secretsmanager:GetSecretValue'],
          resources: [props.dbSecretArn],
        }),
        new iam.PolicyStatement({
          actions: ['secretsmanager:CreateSecret', 'secretsmanager:DeleteSecret', 'secretsmanager:TagResource'],
          resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:Amazon_rds_proxy_multitenant_load_test/Proxy_secret_for_user*`],
        }),
      ],
    });

    lambdaRole.addManagedPolicy(xrayPolicy);
    lambdaRole.addManagedPolicy(cloudWatchLogsPolicy);
    lambdaRole.addManagedPolicy(vpcPolicy);
    lambdaRole.addManagedPolicy(secretManagerPolicy);

    
      const dbProxyPolicy = new iam.ManagedPolicy(this, 'DBProxyPolicy', {
        description: `Allows Lambda Function to modify RDS Proxy to associate with Secrets Manager.`,
        statements: [
          new iam.PolicyStatement({
            actions: ['rds:ModifyDBProxy'],
            resources: [props.dbProxyArn],
          }),
        ],
      });
      lambdaRole.addManagedPolicy(dbProxyPolicy);


    const commonLambdaProps = {
      runtime: lambda.Runtime.PYTHON_3_8,
      role: lambdaRole,
      timeout: cdk.Duration.seconds(900),
      tracing: lambda.Tracing.ACTIVE,
      vpc,
      securityGroups: [lambdaSecurityGroup],
      vpcSubnets: {
        subnets: [ec2.Subnet.fromSubnetId(this, 'PrivateSubnet1', props.privateSubnet1), ec2.Subnet.fromSubnetId(this, 'PrivateSubnet2', props.privateSubnet2)],
      },
      environment: {
        ENDPOINT: props.endpoint,
        USER: 'admin',
        USERS_TO_CREATE: props.usersToCreate.toString(),
        REGION: this.region,
        SECRETARN: props.dbSecretArn,
        DATABASE: 'main',
        NUMBER_OF_ROWS: '1000',
      },
      layers: [lambda.LayerVersion.fromLayerVersionArn(this, 'Layer', props.layerVersionArn)],
    };


      new lambda.Function(this, 'ProxyLambdaFunction', {
        ...commonLambdaProps,
        handler: 'cr_add_users_proxy.handler',
        code: lambda.Code.fromAsset('../src/functions/proxy'),
        environment: {
          ...commonLambdaProps.environment,
          PROXY_NAME: props.dbProxyName,
        },
      });
   
  }
}