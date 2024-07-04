import * as cdk from 'aws-cdk-lib';
import { type Construct } from 'constructs';
import { type Table } from 'aws-cdk-lib/aws-dynamodb';
import { IdentityProvider } from './identity-provider';
import { type ApiKeySSMParameterNames } from '../interfaces/api-key-ssm-parameter-names';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId
} from 'aws-cdk-lib/custom-resources';
import { EcsCluster } from './ecs-cluster';
import { TenantInfraNag } from '../cdknag/tenant-infra-nag';

interface TenantTemplateStackProps extends cdk.StackProps {
  stageName: string
  lambdaReserveConcurrency: number
  lambdaCanaryDeploymentPreference: string
  isPooledDeploy: boolean
  ApiKeySSMParameterNames: ApiKeySSMParameterNames
  tenantId: string
  tenantMappingTable: Table
  commitId: string
  waveNumber?: string
  tier: string
  advancedCluster: string
  appSiteUrl: string
}

export class TenantTemplateStack extends cdk.Stack {
  productServiceUri: string;
  orderServiceUri: string;

  constructor (scope: Construct, id: string, props: TenantTemplateStackProps) {
    super(scope, id, props);
    const waveNumber = props.waveNumber || '1';

    const identityProvider = new IdentityProvider(this, 'IdentityProvider', {
      tenantId: props.tenantId,
      appSiteUrl: props.appSiteUrl
    });

    //=====================================================================
    const ec2Tier = ['advanced', 'premium'];
    const isEc2Tier: boolean = ec2Tier.includes(props.tier.toLowerCase());
    const rProxy = ['advanced', 'premium'];
    const isRProxy: boolean = rProxy.includes(props.tier.toLowerCase());

    new EcsCluster(this, 'EcsCluster', {
      stageName: props.stageName,
      tenantId: props.tenantId,
      tier: props.tier,
      idpDetails: identityProvider.identityDetails,
      isEc2Tier,
      isRProxy,
      advancedCluster: props.advancedCluster,
      env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION
      }
    });
    //=====================================================================

    new AwsCustomResource(this, 'CreateTenantMapping', {
      installLatestAwsSdk: true,
      onCreate: {
        service: 'DynamoDB',
        action: 'putItem',
        physicalResourceId: PhysicalResourceId.of('CreateTenantMapping'),
        parameters: {
          TableName: props.tenantMappingTable.tableName,
          Item: {
            tenantId: { S: props.tenantId },
            stackName: { S: cdk.Stack.of(this).stackName },
            codeCommitId: { S: props.commitId },
            waveNumber: { S: waveNumber }
          }
        }
      },
      onUpdate: {
        service: 'DynamoDB',
        action: 'updateItem',
        physicalResourceId: PhysicalResourceId.of('CreateTenantMapping'),
        parameters: {
          TableName: props.tenantMappingTable.tableName,
          Key: {
            tenantId: { S: props.tenantId }
          },
          UpdateExpression: 'set codeCommitId = :codeCommitId',
          ExpressionAttributeValues: {
            ':codeCommitId': { S: props.commitId }
          }
        }
      },
      onDelete: {
        service: 'DynamoDB',
        action: 'deleteItem',
        parameters: {
          TableName: props.tenantMappingTable.tableName,
          Key: {
            tenantId: { S: props.tenantId }
          }
        }
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: [props.tenantMappingTable.tableArn]
      })
    });

    new cdk.CfnOutput(this, 'TenantUserpoolId', {
      value: identityProvider.tenantUserPool.userPoolId
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: identityProvider.tenantUserPoolClient.userPoolClientId
    });

    new TenantInfraNag(this, 'TenantInfraNag', {
      tenantId: props.tenantId,
      isEc2Tier,
      tier: props.tier,
      advancedCluster: props.advancedCluster,
      isRProxy
    });
  }
}
