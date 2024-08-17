import * as cdk from 'aws-cdk-lib';
import { type Construct } from 'constructs';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyDocument } from 'aws-cdk-lib/aws-iam';
import { EventBus } from 'aws-cdk-lib/aws-events';
import * as fs from 'fs';
import { UserInterface } from './user-interface';
import { CoreAppPlaneNag } from '../cdknag/core-app-plane-nag';
import * as sbt from '@cdklabs/sbt-aws';
import { addTemplateTag } from '../utilities/helper-functions';

interface CoreAppPlaneStackProps extends cdk.StackProps {
  eventManager: sbt.IEventManager
  systemAdminEmail: string
  regApiGatewayUrl: string
}

export class CoreAppPlaneStack extends cdk.Stack {
  public readonly userInterface: UserInterface;
  public readonly tenantMappingTable: Table;
  constructor (scope: Construct, id: string, props: CoreAppPlaneStackProps) {
    super(scope, id, props);
    addTemplateTag(this, 'CoreAppPlaneStack');

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

    this.userInterface = new UserInterface(this, 'saas-application-ui', {
      regApiGatewayUrl: props.regApiGatewayUrl
    });

    new cdk.CfnOutput(this, 'appSiteUrl', {
      value: this.userInterface.appSiteUrl
    });

    new CoreAppPlaneNag(this, 'CoreAppPlaneNag');
  }
}
