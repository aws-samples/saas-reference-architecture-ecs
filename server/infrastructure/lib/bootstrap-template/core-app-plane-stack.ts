import { Stack, type StackProps, CfnOutput } from 'aws-cdk-lib';
import { type Construct } from 'constructs';
import { type ApiKeySSMParameterNames } from '../interfaces/api-key-ssm-parameter-names';
import { TenantApiKey } from './tenant-api-key';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyDocument } from 'aws-cdk-lib/aws-iam';
import { UserInterface } from './user-interface';
import { CoreAppPlaneNag } from '../cdknag/core-app-plane-nag';
import * as fs from 'fs';
import * as core_app_plane from '@cdklabs/sbt-aws';
import { type CoreApplicationPlaneJobRunnerProps, DetailType } from '@cdklabs/sbt-aws';

interface CoreAppPlaneStackProps extends StackProps {
  ApiKeySSMParameterNames: ApiKeySSMParameterNames
  apiKeyPlatinumTierParameter: string
  apiKeyPremiumTierParameter: string
  apiKeyAdvancedTierParameter: string
  apiKeyBasicTierParameter: string

  controlPlaneEventSource: string
  applicationPlaneEventSource: string
  eventBusArn: string
  systemAdminEmail: string
  regApiGatewayUrl: string
}

export class CoreAppPlaneStack extends Stack {
  public readonly userInterface: UserInterface;
  public readonly tenantMappingTable: Table;
  constructor (scope: Construct, id: string, props: CoreAppPlaneStackProps) {
    super(scope, id, props);

    const systemAdminEmail = props.systemAdminEmail;
    const applicationPlaneEventSource = props.applicationPlaneEventSource;
    const controlPlaneEventSource = props.controlPlaneEventSource;
    const eventBusArn = props.eventBusArn;

    this.tenantMappingTable = new Table(this, 'TenantMappingTable', {
      partitionKey: { name: 'tenantId', type: AttributeType.STRING }
    });

    const provisioningJobRunnerProps: CoreApplicationPlaneJobRunnerProps = {
      name: 'provisioning',
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
      script: fs.readFileSync('../../scripts/provision-tenant.sh', 'utf8'),
      outgoingEvent: DetailType.PROVISION_SUCCESS,
      incomingEvent: DetailType.ONBOARDING_REQUEST,

      postScript: '',
      environmentStringVariablesFromIncomingEvent: [
        'tenantId',
        'tier',
        'tenantName',
        'email',
        'tenantStatus'
      ],
      environmentVariablesToOutgoingEvent: ['tenantConfig', 'tenantStatus'],
      scriptEnvironmentVariables: {
        // CDK_PARAM_SYSTEM_ADMIN_EMAIL is required - as part of deploying the bootstrap-template
        // the control plane is also deployed. To ensure the operation does not error out, this value
        // is provided as an env parameter.
        CDK_PARAM_SYSTEM_ADMIN_EMAIL: systemAdminEmail
      }
    };

    const deprovisioningJobRunnerProps: CoreApplicationPlaneJobRunnerProps = {
      name: 'deprovisioning',
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
      script: fs.readFileSync('../../scripts/deprovision-tenant.sh', 'utf8'),
      environmentStringVariablesFromIncomingEvent: ['tenantId', 'tier'],
      environmentVariablesToOutgoingEvent: ['tenantStatus'],
      outgoingEvent: DetailType.DEPROVISION_SUCCESS,
      incomingEvent: DetailType.OFFBOARDING_REQUEST,

      scriptEnvironmentVariables: {
        TENANT_STACK_MAPPING_TABLE: this.tenantMappingTable.tableName,
        CDK_PARAM_SYSTEM_ADMIN_EMAIL: systemAdminEmail
      }
    };

    new core_app_plane.CoreApplicationPlane(this, 'coreappplane-sbt', {
      eventBusArn: eventBusArn,
      controlPlaneEventSource: controlPlaneEventSource,
      applicationPlaneEventSource: applicationPlaneEventSource,
      jobRunnerPropsList: [provisioningJobRunnerProps, deprovisioningJobRunnerProps]
    });

    new TenantApiKey(this, 'BasicTierApiKey', {
      apiKeyValue: props.apiKeyBasicTierParameter,
      ssmParameterApiKeyIdName: props.ApiKeySSMParameterNames.basic.keyId,
      ssmParameterApiValueName: props.ApiKeySSMParameterNames.basic.value
    });

    new TenantApiKey(this, 'AdvancedTierApiKey', {
      apiKeyValue: props.apiKeyAdvancedTierParameter,
      ssmParameterApiKeyIdName: props.ApiKeySSMParameterNames.advanced.keyId,
      ssmParameterApiValueName: props.ApiKeySSMParameterNames.advanced.value
    });

    new TenantApiKey(this, 'PremiumTierApiKey', {
      apiKeyValue: props.apiKeyPremiumTierParameter,
      ssmParameterApiKeyIdName: props.ApiKeySSMParameterNames.premium.keyId,
      ssmParameterApiValueName: props.ApiKeySSMParameterNames.premium.value
    });

    new TenantApiKey(this, 'PlatinumTierApiKey', {
      apiKeyValue: props.apiKeyPlatinumTierParameter,
      ssmParameterApiKeyIdName: props.ApiKeySSMParameterNames.platinum.keyId,
      ssmParameterApiValueName: props.ApiKeySSMParameterNames.platinum.value
    });

    this.userInterface = new UserInterface(this, 'saas-application-ui', {
      regApiGatewayUrl: props.regApiGatewayUrl
    });

    new CfnOutput(this, 'appSiteUrl', {
      value: this.userInterface.appSiteUrl
    });

    new CoreAppPlaneNag(this, 'CoreAppPlaneNag');
  }
}
