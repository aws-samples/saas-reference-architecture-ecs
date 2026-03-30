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

type DbEngine = 'mysql' | 'postgresql';

interface RdsClusterProps {
    stageName: string
    vpc: ec2.IVpc
    env: cdk.Environment
    lambdaEcsSaaSLayers: lambda.LayerVersion
    dbEngine: DbEngine
}

// Engine-specific configuration resolved from dbEngine prop
function resolveEngineConfig(dbEngine: DbEngine) {
  if (dbEngine === 'postgresql') {
    return {
      port: 5432,
      engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_16_4 }),
      adminUser: 'postgres',
      trafficLabel: 'Allow PostgreSQL traffic',
      lambdaEntry: './postgresql-database',
      lambdaIndex: 'postgresql_database.py',
      lambdaId: 'PostgreSqlDatabase',
      proxyPrefix: 'pg',
    };
  }
  return {
    port: 3306,
    engine: rds.DatabaseClusterEngine.auroraMysql({ version: rds.AuroraMysqlEngineVersion.VER_3_08_2 }),
    adminUser: 'admin',
    trafficLabel: 'Allow MySQL traffic',
    lambdaEntry: './mysql-database',
    lambdaIndex: 'mysql_database.py',
    lambdaId: 'MySqlDatabase',
    proxyPrefix: 'db',
  };
}

export class RdsCluster extends Construct {
  public readonly dbName: string;
  public readonly stsRole: iam.Role;
  public readonly schemeLambda: lambda_python.PythonFunction;

  constructor(scope: Construct, id: string, props: RdsClusterProps) {
    super(scope, id);

    const cfg = resolveEngineConfig(props.dbEngine);
    this.dbName = 'sbtsaasdb';

    const securityGroup = new ec2.SecurityGroup(this, 'RdsSecurityGroup', {
      vpc: props.vpc,
      allowAllOutbound: true,
    });
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(cfg.port), cfg.trafficLabel);

    const kmsKey = secretsmanager.Secret.fromSecretCompleteArn(this, 'KmsKey', `arn:aws:secretsmanager:${props.env.region}:${props.env.account}:secret:alias/aws/secretsmanager`).encryptionKey;

    const dbSecret = new secretsmanager.Secret(this, 'DbSecret', {
      secretName: `DBsecret-${id}`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: cfg.adminUser }),
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

    const cluster = new rds.DatabaseCluster(this, 'SbtRDSCluster', {
      engine: cfg.engine,
      serverlessV2MinCapacity: 6.5,
      serverlessV2MaxCapacity: 32,
      vpc: props.vpc,
      securityGroups: [rdsSecurityGroup],
      defaultDatabaseName: this.dbName,
      credentials: rds.Credentials.fromSecret(dbSecret, cfg.adminUser),
      writer: rds.ClusterInstance.serverlessV2('writer'),
      readers: [
        rds.ClusterInstance.serverlessV2('reader1', {
          scaleWithWriter: true,
          enablePerformanceInsights: true,
          performanceInsightRetention: rds.PerformanceInsightRetention.DEFAULT,
        }),
      ],
      storageEncrypted: true,
      storageEncryptionKey: kmsKey,
    });

    // RDS Proxy
    const proxySecurityGroup = new ec2.SecurityGroup(this, 'ProxySecurityGroup', {
      vpc: props.vpc,
      description: 'RDS Proxy Security Group',
      allowAllOutbound: false,
    });

    proxySecurityGroup.addEgressRule(rdsSecurityGroup, ec2.Port.tcp(cfg.port), 'Allow db outbound traffic');
    rdsSecurityGroup.addIngressRule(proxySecurityGroup, ec2.Port.tcp(cfg.port), 'Proxy to RDS ingress rule');

    const dbSecretsRole = new iam.Role(this, 'DBSecretsRole', {
      assumedBy: new iam.ServicePrincipal('rds.amazonaws.com'),
    });

    new iam.ManagedPolicy(this, 'SecretsManagerServiceAccessPolicy', {
      description: 'Allows RDS Proxy to retrieve secrets from Secrets Manager',
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
      dbProxyName: `${props.stageName}-${cfg.proxyPrefix}-dbProxy`,
      proxyTarget: rds.ProxyTarget.fromCluster(cluster),
      secrets: [dbSecret],
      role: dbSecretsRole,
      vpc: props.vpc,
      iamAuth: true,
      securityGroups: [securityGroup],
      requireTLS: true,
    });

    // Lambda for schema provisioning
    const lambdaRole = new iam.Role(this, 'LambdaAddUsersRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchLogsFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
      ],
    });
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['secretsmanager:GetSecretValue'],
      resources: [dbSecret.secretArn],
    }));
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['secretsmanager:CreateSecret', 'secretsmanager:DeleteSecret', 'secretsmanager:TagResource', 'secretsmanager:DescribeSecret'],
      resources: [`arn:aws:secretsmanager:${props.env.region}:${props.env.account}:secret:rds_proxy_multitenant/proxy_secret_for_user*`],
    }));
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['rds:ModifyDBProxy'],
      resources: [rdsProxy.dbProxyArn],
    }));
    lambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['rds:DescribeDBProxies'],
      resources: [`arn:aws:rds:${props.env.region}:${props.env.account}:db-proxy:*`],
    }));

    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc: props.vpc,
      description: 'Lambda Security Group',
      allowAllOutbound: true,
    });
    lambdaSecurityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow outbound HTTPS traffic');
    lambdaSecurityGroup.addEgressRule(
      ec2.SecurityGroup.fromSecurityGroupId(this, 'LambdaSGOutToDB', rdsSecurityGroup.securityGroupId),
      ec2.Port.tcp(cfg.port), 'Allow DB outbound traffic'
    );

    new ec2.CfnSecurityGroupIngress(this, 'LambdaToRDSIngress', {
      ipProtocol: 'tcp',
      fromPort: cfg.port,
      toPort: cfg.port,
      groupId: rdsSecurityGroup.securityGroupId,
      sourceSecurityGroupId: lambdaSecurityGroup.securityGroupId,
    });

    this.schemeLambda = new lambda_python.PythonFunction(this, cfg.lambdaId, {
      entry: path.join(__dirname, cfg.lambdaEntry),
      handler: 'lambda_handler',
      index: cfg.lambdaIndex,
      runtime: lambda.Runtime.PYTHON_3_10,
      tracing: lambda.Tracing.ACTIVE,
      layers: [props.lambdaEcsSaaSLayers],
      environment: {
        DB_NAME: this.dbName,
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_RESOURCE_ARN: `arn:aws:rds:${props.env.region}:${props.env.account}:cluster:${cluster.instanceIdentifiers}`,
        DB_PROXY_ARN: rdsProxy.dbProxyArn,
        DB_PROXY_NAME: rdsProxy.dbProxyName,
        DB_PROXY_ENDPOINT: rdsProxy.endpoint,
        DB_ENDPOINT: cluster.clusterEndpoint.hostname,
        REGION: props.env.region || '',
      },
      vpc: cluster.vpc,
      securityGroups: [lambdaSecurityGroup],
      role: lambdaRole,
      timeout: cdk.Duration.minutes(15),
    });

    dbSecret.grantRead(this.schemeLambda);
    dbSecret.grantWrite(this.schemeLambda);

    // STS Role for IAM auth
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

    const taskRole = new iam.Role(this, 'sbt-ecsTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonEC2ContainerServiceforEC2Role')
    );

    this.stsRole.assumeRolePolicy?.addStatements(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        effect: iam.Effect.ALLOW,
        principals: [new iam.ArnPrincipal(taskRole.roleArn)],
      })
    );

    this.stsRole.assumeRolePolicy?.addStatements(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        effect: iam.Effect.ALLOW,
        principals: [new iam.ArnPrincipal(`arn:aws:iam::${props.env.account}:root`)],
        conditions: {
          'ArnLike': {
            'aws:PrincipalArn': `arn:aws:iam::${props.env.account}:role/tenant-service-stack-*`
          }
        }
      })
    );

    // Outputs
    new cdk.CfnOutput(this, 'STSRoleArn', { value: this.stsRole.roleArn, exportName: 'STSRoleArn' });
    new cdk.CfnOutput(this, 'SchemeLambdaArn', { value: this.schemeLambda.functionArn, exportName: 'SchemeLambdaArn' });
    new cdk.CfnOutput(this, 'TaskRoleArn', { value: taskRole.roleArn, exportName: 'TaskRoleArn' });
    new cdk.CfnOutput(this, 'DbProxyArn', { value: rdsProxy.dbProxyArn, exportName: 'DbProxyArn' });
    new cdk.CfnOutput(this, 'SecretArn', { value: dbSecret.secretArn, exportName: 'SecretArn' });
    new cdk.CfnOutput(this, 'DbProxyName', { value: rdsProxy.dbProxyName, exportName: 'DbProxyName' });
    new cdk.CfnOutput(this, 'RdsProxyEndpoint', { value: rdsProxy.endpoint, exportName: 'RdsProxyEndpoint' });
    new cdk.CfnOutput(this, 'SecurityGroupId', { value: securityGroup.securityGroupId, exportName: 'SecurityGroupId' });
  }
}
