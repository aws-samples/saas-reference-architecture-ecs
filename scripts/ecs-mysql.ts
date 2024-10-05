import * as cdk from 'aws-cdk-lib';
import { SecretsManager, RDS } from 'aws-sdk';
import * as mysql from 'mysql2/promise';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';


import { Construct } from 'constructs';

export interface EcsDynamoDBProps  {
  name: string
  tenantId: string
  tenantName: string
  sortKey: string
  tableName: string
}

export class EcsDynamoDB extends Construct {
  public readonly tableArn: string;
  public readonly databaseSecret: secretsmanager.Secret;


  constructor (scope: Construct, id: string, props: EcsDynamoDBProps) {
    super(scope, id);

    const tenantName = props.tenantName;
    if (!tenantName) {
      throw new Error('Tenant ID is required');
    }
  
    try {
    // alb Security Group ID
    // const albSGId = cdk.Fn.importValue('AlbSgId');
    // const albSG = ec2.SecurityGroup.fromSecurityGroupId(this, 'albSG', albSGId);

      const proxyEndPoint=cdk.Fn.importValue('DbProxyEndpoint');
      const dbEndpoint=cdk.Fn.importValue('DbEndpoint');
      const port=cdk.Fn.importValue('port');
      const dbName=cdk.Fn.importValue('DbName');
      const proxyName=cdk.Fn.importValue('ProxyName');
      const secretArn=cdk.Fn.importValue('SecretArn');
      const aUser=cdk.Fn.importValue('User');
      const secretsManager = new SecretsManager();


      const databaseName = `tenant_${props.tenantName}_db`;
      const databaseUsername = `user_${props.tenantName}`;
      const databaseUserPassword = secretsmanager.Secret.fromSecretAttributes(this, 'TenantDatabaseSecret', {
        secretCompleteArn: `${cdk.Stack.of(this).formatArn({
          service: 'secretsmanager',
          resource: 'secret',
          resourceName: `rds_proxy_multitenant/proxy_secret_for_user_${props.tenantName}`,
        })}`,
    }).secretValueFromJson('password');

    const createdDatabase = new rds.DatabaseInstance(this, 'TenantDatabase', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.AuroraMysqlEngineVersion.VER_3_02_0,
      }),
      cluster: databaseCluster,
      instanceType: cdk.ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE2, ec2.InstanceSize.SMALL),
      vpc: props.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      },
      databaseName,
      credentials: rds.Credentials.fromUsername(databaseUsername, databaseUserPassword),
    });

    createdDatabase.connections.allowFrom(proxy.connections, ec2.Port.tcp(3306));

    this.databaseSecret = secretsmanager.Secret.fromSecretAttributes(this, 'TenantDatabaseSecret', {
      secretCompleteArn: `${cdk.Stack.of(this).formatArn({
        service: 'secretsmanager',
        resource: 'secret',
        resourceName: `rds_proxy_multitenant/proxy_secret_for_user_${props.tenantName}`,
      })}`,
    });

    createdDatabase.node.addDependency(this.databaseSecret);
    }catch (e) {
      console.error(`Database connection or schema creation failed due to ${e}`);
      throw e;
    }
  }
}
