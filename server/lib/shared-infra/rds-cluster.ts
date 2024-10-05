import * as cdk from 'aws-cdk-lib';
import { Aws } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda_python from '@aws-cdk/aws-lambda-python-alpha';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';

interface RdsClusterProps {
    stageName: string
    vpc: ec2.IVpc
    env: cdk.Environment
    lambdaEcsSaaSLayers: lambda.LayerVersion,
  }


export class RdsCluster extends Construct {
  public readonly dbName: string;
  public readonly stsRole: iam.Role;
  public readonly schemeLambda: lambda_python.PythonFunction;

  constructor(scope: Construct, id: string, props: RdsClusterProps) {
    super(scope, id);

    this.dbName='sbtsaaasdb';
    const securityGroup = new ec2.SecurityGroup(this, 'RdsSecurityGroup', {
      vpc: props.vpc,
      allowAllOutbound: true,
    });
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(3306), 'Allow MySQL traffic');

    const kmsKey = secretsmanager.Secret.fromSecretCompleteArn(this, 'KmsKey', `arn:aws:secretsmanager:${props.env.region}:${props.env.account}:secret:alias/aws/secretsmanager`).encryptionKey;
    // Credentials create in Secrets Manager 
    const dbSecret = new secretsmanager.Secret(this, 'DbSecret', {
      secretName: `DbSecret-${id}`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'admin' }),
        excludePunctuation: true,
        includeSpace: false,
        generateStringKey: 'password',
      },
      encryptionKey: kmsKey,

    });


    const rdsSecurityGroup = new ec2.SecurityGroup(this, 'RDSSecurityGroup', {
      vpc: props.vpc,
      description: 'RDS Security Group',
      allowAllOutbound: false,
    });
    // rdsSecurityGroup.connections.allowFrom(rdsSecurityGroup, ec2.Port.tcp(3306), 'Backend Microservices');

    const cluster = new rds.DatabaseCluster(this, 'SbtRDSCluster', {
        engine: rds.DatabaseClusterEngine.auroraMysql({ version: rds.AuroraMysqlEngineVersion.VER_3_05_2 }),
        
        serverlessV2MinCapacity: 6.5,
        serverlessV2MaxCapacity: 32,
        vpc: props.vpc,
        securityGroups: [rdsSecurityGroup],
        defaultDatabaseName: this.dbName,
        
        
        credentials: rds.Credentials.fromSecret(dbSecret, 'admin'),
        // {
        //   username: 'admin',
        //   password: dbSecret.secretValueFromJson('password'),
        // },
        writer: rds.ClusterInstance.provisioned('writer', {
          instanceType: ec2.InstanceType.of(ec2.InstanceClass.R6G, ec2.InstanceSize.XLARGE4),
        //   publiclyAccessible: false,
        }),
        readers: [
          // will be put in promotion tier 1 and will scale with the writer
          rds.ClusterInstance.serverlessV2('reader1', { 
            scaleWithWriter: true,
            enablePerformanceInsights: true,
            performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
            // publiclyAccessible: false,
          }),
          // will be put in promotion tier 2 and will not scale with the writer
          // rds.ClusterInstance.serverlessV2('reader2', {
          //   enablePerformanceInsights: true,
          //   performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
          //   // publiclyAccessible: false,
          // }),
        ],
        storageEncrypted: true, 
        storageEncryptionKey: kmsKey, // KMS Key
        // iamAuthentication: false
      });

    // RDS Proxy
    const proxySecurityGroup = new ec2.SecurityGroup(this, 'ProxySecurityGroup', {
      vpc: props.vpc,
      description: 'RDS Proxy Security Group',
      allowAllOutbound: false,
    });

    proxySecurityGroup.addEgressRule(
      rdsSecurityGroup,
      ec2.Port.tcp(3306),
      'Allow db outbound traffic',
    );

    rdsSecurityGroup.addIngressRule(
      proxySecurityGroup,
      ec2.Port.tcp(3306),
      'Proxy to RDS ingress rule',
    );

    const dbSecretsRole = new iam.Role(this, 'DBSecretsRole', {
      assumedBy: new iam.ServicePrincipal('rds.amazonaws.com'),
    });

    new iam.ManagedPolicy(this, 'SecretsManagerSeviceAccessPolicy', {
      description: `Allows RDS Proxy to retrieve a secret from Secrets Manager with the correct ARN.`,
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue'],
          resources: [
            dbSecret.secretArn,
            `arn:${Aws.PARTITION}:secretsmanager:${props.env.region}:${props.env.account}:secret:rds_proxy_multitenant/proxy_secret_for_user*`,
          ],
        }),
      ],
      roles: [dbSecretsRole],
    });

    const rdsProxy = new rds.DatabaseProxy(this, 'SbtRDSProxy', {
      dbProxyName: `${props.stageName}-db-dbProxy`,
      proxyTarget: rds.ProxyTarget.fromCluster(cluster),
      secrets: [dbSecret],
      role: dbSecretsRole,
      vpc: props.vpc,
      iamAuth: true,  // IAM Auth Enable
      securityGroups: [securityGroup],
      requireTLS: true,
    });
    rdsProxy.dbProxyArn;

    const lambdaRole = new iam.Role(this, 'LambdaAddUsersRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:GetSecretValue'],
        resources: [dbSecret.secretArn],
      })
    );

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['secretsmanager:CreateSecret', 'secretsmanager:DeleteSecret', 'secretsmanager:TagResource'],
        resources: [`arn:aws:secretsmanager:${props.env.region}:${props.env.account}:secret:rds_proxy_multitenant/proxy_secret_for_user*`],
      })
    );

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['rds:ModifyDBProxy'],
        resources: [rdsProxy.dbProxyArn],
      })
    );

    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['rds:DescribeDBProxies'],
        resources: [`arn:aws:rds:${props.env.region}:${props.env.account}:db-proxy:*`],
      })
    );

/////////////////start
// const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
//   vpc: props.vpc,
//   description: 'Lambda Security Group',
//   allowAllOutbound: true,
// });

// lambdaSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow outbound HTTPS traffic');
// lambdaSecurityGroup.addEgressRule(ec2.SecurityGroup.fromSecurityGroupId(this, 'RDSSecurityGroup2', rdsSecurityGroup.securityGroupId), ec2.Port.tcp(3306), 'Allow DB outbound traffic');

// const lambdaToRDSIngress = new ec2.CfnSecurityGroupIngress(this, 'LambdaToRDSIngress', {
//   ipProtocol: 'tcp',
//   fromPort: 3306,
//   toPort: 3306,
//   groupId: rdsSecurityGroup.securityGroupId,
//   sourceSecurityGroupId: lambdaSecurityGroup.securityGroupId,
// });


//   new ec2.CfnSecurityGroupIngress(this, 'LambdaToProxyIngress', {
//     ipProtocol: 'tcp',
//     fromPort: 3306,
//     toPort: 3306,
//     groupId: rdsSecurityGroup.securityGroupId,
//     sourceSecurityGroupId: lambdaSecurityGroup.securityGroupId,
//   });


// const lambdaRole2 = new iam.Role(this, 'LambdaAddUsersRole2', {
//   assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
// });

// lambdaRole2.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));

// const xrayPolicy = new iam.ManagedPolicy(this, 'XrayServiceAccessPolicy', {
//   description: `Allows Lambda Function to access X-Ray.`,
//   statements: [
//     new iam.PolicyStatement({
//       actions: [
//         'xray:PutTraceSegments',
//         'xray:PutTelemetryRecords',
//         'xray:GetSamplingRules',
//         'xray:GetSamplingTargets',
//         'xray:GetSamplingStatisticSummaries'
//       ],
//       resources: ['*'],
//     }),
//   ],
// });

// const cloudWatchLogsPolicy = new iam.ManagedPolicy(this, 'CloudWatchLogsServiceAccessPolicy', {
//   description: `Allows Lambda Function to access CloudWatch logs.`,
//   statements: [
//     new iam.PolicyStatement({
//       actions: [
//         'logs:CreateLogGroup',
//         'logs:CreateLogStream',
//         'logs:PutLogEvents'
//       ],
//       resources: [
//         `arn:aws:logs:${props.env.region}:${props.env.account}:log-group:*`,
//         `arn:aws:logs:${props.env.region}:${props.env.account}:log-group:*:log-stream:*`
//       ],
//     }),
//   ],
// });

// const vpcPolicy = new iam.ManagedPolicy(this, 'VPCServiceAccessPolicy', {
//   description: `Allows Lambda Function to create and delete network interfaces.`,
//   statements: [
//     new iam.PolicyStatement({
//       actions: ['ec2:DescribeNetworkInterfaces'],
//       resources: ['*'],
//     }),
//     new iam.PolicyStatement({
//       actions: [
//         'ec2:CreateNetworkInterface',
//         'ec2:DeleteNetworkInterface',
//         'ec2:AssignPrivateIpAddresses',
//         'ec2:UnassignPrivateIpAddresses',
//       ],
//       resources: ['*'],
//     }),
//   ],
// });

// const secretManagerPolicy = new iam.ManagedPolicy(this, 'SecretsManagerServiceAccessPolicy', {
//   description: `Allows Lambda Function to access and manage Secrets Manager secrets.`,
//   statements: [
//     new iam.PolicyStatement({
//       actions: ['secretsmanager:GetSecretValue'],
//       resources: [dbSecret.secretArn],
//     }),
//     new iam.PolicyStatement({
//       actions: ['secretsmanager:CreateSecret', 'secretsmanager:DeleteSecret', 'secretsmanager:TagResource'],
//       resources: [`arn:aws:secretsmanager:${props.env.region}:${props.env.account}:secret:rds_proxy_multitenant/proxy_secret_for_user*`],
//     }),
//   ],
// });

// lambdaRole2.addManagedPolicy(xrayPolicy);
// lambdaRole2.addManagedPolicy(cloudWatchLogsPolicy);
// lambdaRole2.addManagedPolicy(vpcPolicy);
// lambdaRole2.addManagedPolicy(secretManagerPolicy);


//   const dbProxyPolicy = new iam.ManagedPolicy(this, 'DBProxyPolicy', {
//     description: `Allows Lambda Function to modify RDS Proxy to associate with Secrets Manager.`,
//     statements: [
//       new iam.PolicyStatement({
//         actions: ['rds:ModifyDBProxy'],
//         resources: [dbSecret.secretArn],
//       }),
//     ],
//   });

//   const dbProxyPolicy2 = new iam.ManagedPolicy(this, 'DBProxyPolicy2', {
//     description: `Allows Lambda Function to modify RDS Proxy to associate with Secrets Manager.`,
//     statements: [
//       new iam.PolicyStatement({
//         actions: ["rds-db:connect"],
//         resources: [
//           `arn:aws:rds-db:${props.env.region}:${props.env.account}:dbuser:${cluster.clusterResourceIdentifier}/admin`
//         ],
//       }),
//     ],
//   });
//   lambdaRole2.addManagedPolicy(dbProxyPolicy);
//   lambdaRole2.addManagedPolicy(dbProxyPolicy2);


//////////////

    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: props.vpc,
      description: 'Lambda Security Group',
      allowAllOutbound: true,
    });
    lambdaSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow outbound HTTPS traffic');
    lambdaSecurityGroup.addEgressRule(ec2.SecurityGroup.fromSecurityGroupId(this, 'LambdaSGOutToDB', rdsSecurityGroup.securityGroupId), ec2.Port.tcp(3306), 'Allow DB outbound traffic');

    new ec2.CfnSecurityGroupIngress(this, 'LambdaToRDSIngress', {
      ipProtocol: 'tcp',
      fromPort: 3306,
      toPort: 3306,
      groupId: rdsSecurityGroup.securityGroupId,
      sourceSecurityGroupId: lambdaSecurityGroup.securityGroupId,
    });

    // new ec2.CfnSecurityGroupIngress(this, 'LambdaToProxyIngress', {
    //   ipProtocol: 'tcp',
    //   fromPort: 3306,
    //   toPort: 3306,
    //   groupId: rdsSecurityGroup.securityGroupId,
    //   sourceSecurityGroupId: lambdaSecurityGroup.securityGroupId,
    // });

    this.schemeLambda = new lambda_python.PythonFunction(this, 'MySqlDababase', {
      entry: path.join(__dirname, './mysql-database'),
      handler: 'lambda_handler',
      index: 'mysql_database.py',
      runtime: lambda.Runtime.PYTHON_3_10,
      tracing: lambda.Tracing.ACTIVE,
      layers: [props.lambdaEcsSaaSLayers],
      environment: {
        // USER: 'admin',
        DB_NAME: this.dbName,
        DB_SECRET_ARN: dbSecret.secretArn, //cluster.secret?.secretArn ||'',
        DB_RESOURCE_ARN: `arn:aws:rds:${props.env.region}:${props.env.account}:cluster:${cluster.instanceIdentifiers}`,
        DB_PROXY_ARN: rdsProxy.dbProxyArn,
        DB_PROXY_NAME: rdsProxy.dbProxyName,
        DB_PROXY_ENDPOINT: rdsProxy.endpoint,
        DB_ENDPOINT: cluster.clusterEndpoint.hostname,
        REGION: props.env.region || '',
      },
      vpc: cluster.vpc,
      
      // vpcSubnets: { //this is for RDS_PROXY
      //     subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      // },
      securityGroups: [lambdaSecurityGroup],
      role: lambdaRole,
      timeout: cdk.Duration.seconds(15),
    });
  
    dbSecret.grantRead(this.schemeLambda);
    dbSecret.grantWrite(this.schemeLambda);

  //STS
    const stsRolePermissions = new cdk.aws_iam.PolicyDocument({
      statements: [
        new cdk.aws_iam.PolicyStatement({
          actions: ['rds-db:connect'],
          resources: [`arn:aws:rds-db:${props.env.region}:${props.env.account}:dbuser:*`],
        })
      ],
    });

    this.stsRole = new iam.Role(this, 'STSRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      inlinePolicies: { STSRolePermissions: stsRolePermissions }
    });

    new cdk.CfnOutput(this, 'STSRoleArn', {
      value: this.stsRole.roleArn,
      description: 'The ARN of the STS Role',
      exportName: 'STSRoleArn'
    });

    // const policyDocument = iam.PolicyDocument.fromJson(JSON.parse(policy));
    const taskRole = new iam.Role(this, `sbt-ecsTaskRole`, {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role')
    );
    // ### DynamoDB ABAC not GA yet 
    // taskRole.addToPolicy(new iam.PolicyStatement({
    //   actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 
    //     'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:Query'],
    //   resources: [`arn:aws:dynamodb:${props.env.region}:${props.env.account}:table/*-table-name-*`],
    //   conditions: {
    //     'StringEquals': {
    //       'aws:ResourceTag/TenantName': '${aws:PrincipalTag/TenantName}' // 태그 기반으로 접근 제한
    //     }
    //   }
    // }));

    this.stsRole.assumeRolePolicy?.addStatements(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        effect: iam.Effect.ALLOW,
        principals: [new iam.ArnPrincipal(taskRole.roleArn)],
      })
    );

    new cdk.CfnOutput(this, 'TaskRoleArn', {
      value: taskRole.roleArn,
      description: 'The ARN of the Task Role',
      exportName: 'TaskRoleArn'
    });

    new cdk.CfnOutput(this, 'DbProxyArn', {
      value: rdsProxy.dbProxyArn,
      exportName: 'DbProxyArn'
    });
  
    new cdk.CfnOutput(this, 'SecretArn', {
     value: dbSecret.secretArn,
     exportName: 'SecretArn'
    });
 
    new cdk.CfnOutput(this, 'DbProxyName', {
      value: rdsProxy.dbProxyName,
      exportName: 'DbProxyName'
    });
  
    new cdk.CfnOutput(this, 'RdsProxyEndpoint', {
      value: rdsProxy.endpoint,
      exportName: 'RdsProxyEndpoint'
    });

    new cdk.CfnOutput(this, 'SecurityGroupId', {
      value: securityGroup.securityGroupId,
      exportName: 'SecurityGroupId'
    });
  
  }
}

