import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';
import { type Construct } from 'constructs';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, PolicyDocument, PolicyStatement } from 'aws-cdk-lib/aws-iam';
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
  auth: sbt.CognitoAuth // auth 정보 추가
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

    const provisioningScriptJobProps : sbt.TenantLifecycleScriptJobProps = {
      permissions: new PolicyDocument({
        statements: [
          new PolicyStatement({
            actions: [
              '*'
            ],
            resources: ['*'],
            effect: Effect.ALLOW,
          }),
        ],
      }),
      script: fs.readFileSync('./lib/provision-scripts/provision-tenant.sh', 'utf8'),
      environmentStringVariablesFromIncomingEvent: ['tenantId', 'tier', 'tenantName', 'email', 'useFederation'],
      environmentJSONVariablesFromIncomingEvent: ['prices'],
      environmentVariablesToOutgoingEvent: { 
        tenantData:[
          'tenantS3Bucket',
          'tenantConfig',
          'prices', // added so we don't lose it for targets beyond provisioning (ex. billing)
          'tenantName', // added so we don't lose it for targets beyond provisioning (ex. billing)
          'email', // added so we don't lose it for targets beyond provisioning (ex. billing)
        ],
        tenantRegistrationData: ['registrationStatus'],
      },
      scriptEnvironmentVariables: {
        // CDK_PARAM_SYSTEM_ADMIN_EMAIL is required because as part of deploying the bootstrap-template
        // the control plane is also deployed. To ensure the operation does not error out, this value
        // is provided as an env parameter.
        CDK_PARAM_SYSTEM_ADMIN_EMAIL: systemAdminEmail,
      },
      eventManager: props.eventManager
    };

    const deprovisioningScriptJobProps: sbt.TenantLifecycleScriptJobProps = {
      permissions: new PolicyDocument({
        statements: [
          new PolicyStatement({
            actions: [
              '*'
            ],
            resources: ['*'],
            effect: Effect.ALLOW,
          }),
        ],
      }),
      script: fs.readFileSync('./lib/provision-scripts/deprovision-tenant.sh', 'utf8'),
      environmentStringVariablesFromIncomingEvent: ['tenantId', 'tier'],
      environmentVariablesToOutgoingEvent: {
        tenantRegistrationData:['registrationStatus']
      },

      scriptEnvironmentVariables: {
        TENANT_STACK_MAPPING_TABLE: props.tenantMappingTable.tableName,
        // CDK_PARAM_SYSTEM_ADMIN_EMAIL is required because as part of deploying the bootstrap-template
        // the control plane is also deployed. To ensure the operation does not error out, this value
        // is provided as an env parameter.
        CDK_PARAM_SYSTEM_ADMIN_EMAIL: systemAdminEmail,
      },
      eventManager: props.eventManager
    };

    const provisioningScriptJob: sbt.ProvisioningScriptJob = new sbt.ProvisioningScriptJob(
      this,
      'provisioningScriptJob', 
      provisioningScriptJobProps
    );

    const deprovisioningScriptJob: sbt.DeprovisioningScriptJob = new sbt.DeprovisioningScriptJob(
      this,
      'deprovisioningScriptJob', 
      deprovisioningScriptJobProps
    );

    new sbt.CoreApplicationPlane(this, 'coreappplane-sbt', {
      eventManager: props.eventManager,
      scriptJobs: [provisioningScriptJob, deprovisioningScriptJob]
    });

    // Check if Application directory exists before creating StaticSite
    const applicationPath = path.join(__dirname, '../../../client/Application');
    
    let staticSite;
    if (fs.existsSync(applicationPath)) {
      staticSite = new StaticSite(this, 'TenantWebUI', {
        name: 'AppSite',
        assetDirectory: applicationPath,
        production: true,
        clientId: props.auth.userClientId, // auth 정보 추가
        issuer: props.auth.tokenEndpoint, // auth 정보 추가
        apiUrl: props.regApiGatewayUrl,
        wellKnownEndpointUrl: props.auth.wellKnownEndpointUrl, // auth 정보 추가
        distribution: props.distro.cloudfrontDistribution,
        appBucket: props.distro.siteBucket,
        accessLogsBucket: props.accessLogsBucket,
        env: {
          account: this.account,
          region: this.region
        }
      });
    } else {
      console.log('Application directory not found, skipping StaticSite creation');
    }

    new cdk.CfnOutput(this, 'appSiteUrl', {
      value: props.appSiteUrl
    });

    // new CoreAppPlaneNag(this, 'CoreAppPlaneNag');
  }
}
