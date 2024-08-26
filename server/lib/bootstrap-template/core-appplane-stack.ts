import * as cdk from 'aws-cdk-lib';
import { type Construct } from 'constructs';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyDocument } from 'aws-cdk-lib/aws-iam';
import * as fs from 'fs';
import { CoreAppPlaneNag } from '../cdknag/core-app-plane-nag';
import { addTemplateTag } from '../utilities/helper-functions';
import { StaticSiteDistro } from './static-site-distro';
import path = require('path');
import { StaticSite } from './static-site';
import * as sbt from '@cdklabs/sbt-aws';

interface CoreAppPlaneStackProps extends cdk.StackProps {
  eventManager: sbt.IEventManager
  systemAdminEmail: string
  regApiGatewayUrl: string
}

export class CoreAppPlaneStack extends cdk.Stack {
  public readonly tenantMappingTable: Table;
  public readonly appBucket: cdk.aws_s3.Bucket;
  public readonly appSiteUrl: string;

  constructor (scope: Construct, id: string, props: CoreAppPlaneStackProps) {
    super(scope, id, props);
    addTemplateTag(this, 'CoreAppPlaneStack');

    const accessLogsBucket = new cdk.aws_s3.Bucket(this, 'AccessLogsBucket', {
      enforceSSL: true,
      autoDeleteObjects: true,
      accessControl: cdk.aws_s3.BucketAccessControl.LOG_DELIVERY_WRITE,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    const distro = new StaticSiteDistro(this, 'StaticSiteDistro', {
      allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
      accessLogsBucket
    });

    this.appSiteUrl = `https://${distro.cloudfrontDistribution.domainName}`;

    const systemAdminEmail = props.systemAdminEmail;

    this.tenantMappingTable = new Table(this, 'TenantMappingTable', {
      partitionKey: { name: 'tenantId', type: AttributeType.STRING }
    });

    const provisioningJobRunnerProps = {
      permissions: PolicyDocument.fromJson(
        JSON.parse(`
{
  "Version":"2012-10-17",
  "Statement":[
      {
        "Action":[
            "*"
        ],
        "Resource":"*",
        "Effect":"Allow"
      }
  ]
}
`)
      ),
      script: fs.readFileSync('../scripts/provision-tenant.sh', 'utf8'),
      environmentStringVariablesFromIncomingEvent: ['tenantId', 'tier', 'tenantName', 'email'],
      environmentVariablesToOutgoingEvent: [
        'tenantConfig',
        'tenantStatus',
        'prices', // added so we don't lose it for targets beyond provisioning (ex. billing)
        'tenantName', // added so we don't lose it for targets beyond provisioning (ex. billing)
        'email', // added so we don't lose it for targets beyond provisioning (ex. billing)
      ],
      scriptEnvironmentVariables: {
        // CDK_PARAM_SYSTEM_ADMIN_EMAIL is required because as part of deploying the bootstrap-template
        // the control plane is also deployed. To ensure the operation does not error out, this value
        // is provided as an env parameter.
        CDK_PARAM_SYSTEM_ADMIN_EMAIL: systemAdminEmail,
      },
      outgoingEvent: sbt.DetailType.PROVISION_SUCCESS,
      incomingEvent: sbt.DetailType.ONBOARDING_REQUEST,
      eventManager: props.eventManager
    };

    const deprovisioningJobRunnerProps = {
      permissions: PolicyDocument.fromJson(
        JSON.parse(`
{
  "Version":"2012-10-17",
  "Statement":[
      {
        "Action":[
            "*"
        ],
        "Resource":"*",
        "Effect":"Allow"
      }
  ]
}
`)
      ),
      script: fs.readFileSync('../scripts/deprovision-tenant.sh', 'utf8'),
      environmentStringVariablesFromIncomingEvent: ['tenantId', 'tier'],
      environmentVariablesToOutgoingEvent: ['tenantStatus'],
      outgoingEvent: sbt.DetailType.DEPROVISION_SUCCESS,
      incomingEvent: sbt.DetailType.OFFBOARDING_REQUEST,
      scriptEnvironmentVariables: {
        TENANT_STACK_MAPPING_TABLE: this.tenantMappingTable.tableName,
        // CDK_PARAM_SYSTEM_ADMIN_EMAIL is required because as part of deploying the bootstrap-template
        // the control plane is also deployed. To ensure the operation does not error out, this value
        // is provided as an env parameter.
        CDK_PARAM_SYSTEM_ADMIN_EMAIL: systemAdminEmail,
      },
      eventManager: props.eventManager
    };

    const provisioningJobRunner: sbt.BashJobRunner = new sbt.BashJobRunner(this,
      'provisioningJobRunner', provisioningJobRunnerProps
    );

    const deprovisioningJobRunner: sbt.BashJobRunner = new sbt.BashJobRunner(this,
      'deprovisioningJobRunner', deprovisioningJobRunnerProps
    );

    new sbt.CoreApplicationPlane(this, 'coreappplane-sbt', {
      eventManager: props.eventManager,
      jobRunnersList: [provisioningJobRunner, deprovisioningJobRunner]
    });

    const staticSite = new StaticSite(this, 'TenantWebUI', {
      name: 'AppSite',
      assetDirectory: path.join(__dirname, '../../../client/Application'),
      production: true,
      apiUrl: props.regApiGatewayUrl,
      distribution: distro.cloudfrontDistribution,
      appBucket: distro.siteBucket,
      accessLogsBucket
    });

    new cdk.CfnOutput(this, 'appSiteUrl', {
      value: this.appSiteUrl
    });

    new CoreAppPlaneNag(this, 'CoreAppPlaneNag');
  }
}
