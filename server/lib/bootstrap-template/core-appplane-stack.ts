import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';
import { type Construct } from 'constructs';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyDocument } from 'aws-cdk-lib/aws-iam';
import { addTemplateTag } from '../utilities/helper-functions';
import { StaticSiteDistro } from '../shared-infra/static-site-distro';
import path = require('path');
import { StaticSite } from './static-site';
import { CoreAppPlaneNag } from '../cdknag/core-app-plane-nag';
import * as sbt from '@cdklabs/sbt-aws';

interface CoreAppPlaneStackProps extends cdk.StackProps {
  eventManager: sbt.IEventManager
  systemAdminEmail: string
  regApiGatewayUrl: string
  distro: StaticSiteDistro
  appSiteUrl: string
  accessLogsBucket: cdk.aws_s3.Bucket
  tenantMappingTable: Table
}

export class CoreAppPlaneStack extends cdk.Stack {
  public readonly appBucket: cdk.aws_s3.Bucket;
  public readonly appSiteUrl: string;

  constructor (scope: Construct, id: string, props: CoreAppPlaneStackProps) {
    super(scope, id, props);
    addTemplateTag(this, 'CoreAppPlaneStack');

    const systemAdminEmail = props.systemAdminEmail;

    const provisioningScriptJobProps = {
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

    const deprovisioningScriptJobProps = {
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
        TENANT_STACK_MAPPING_TABLE: props.tenantMappingTable.tableName,
        // CDK_PARAM_SYSTEM_ADMIN_EMAIL is required because as part of deploying the bootstrap-template
        // the control plane is also deployed. To ensure the operation does not error out, this value
        // is provided as an env parameter.
        CDK_PARAM_SYSTEM_ADMIN_EMAIL: systemAdminEmail,
      },
      eventManager: props.eventManager
    };

    const provisioningScriptJob: sbt.ProvisioningScriptJob = new sbt.ProvisioningScriptJob(this,
      'provisioningScriptJob', provisioningScriptJobProps
    );

    const deprovisioningScriptJob: sbt.ProvisioningScriptJob = new sbt.DeprovisioningScriptJob(this,
      'deprovisioningScriptJob', deprovisioningScriptJobProps
    );

    new sbt.CoreApplicationPlane(this, 'coreappplane-sbt', {
      eventManager: props.eventManager,
      scriptJobs: [provisioningScriptJob, deprovisioningScriptJob]
    });

    const staticSite = new StaticSite(this, 'TenantWebUI', {
      name: 'AppSite',
      assetDirectory: path.join(__dirname, '../../../client/Application'),
      production: true,
      apiUrl: props.regApiGatewayUrl,
      distribution: props.distro.cloudfrontDistribution,
      appBucket: props.distro.siteBucket,
      accessLogsBucket: props.accessLogsBucket,
      env: {
        account: this.account,
        region: this.region
      }
    });

    new cdk.CfnOutput(this, 'appSiteUrl', {
      value: props.appSiteUrl
    });

    new CoreAppPlaneNag(this, 'CoreAppPlaneNag');
  }
}
