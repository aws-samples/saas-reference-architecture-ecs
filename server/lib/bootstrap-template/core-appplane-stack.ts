import * as cdk from 'aws-cdk-lib';
import { type Construct } from 'constructs';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyDocument } from 'aws-cdk-lib/aws-iam';
import { EventBus } from 'aws-cdk-lib/aws-events';
import * as fs from 'fs';
import { UserInterface } from './user-interface';
import { CoreAppPlaneNag } from '../cdknag/core-app-plane-nag';
import * as sbt from '@cdklabs/sbt-aws';

interface CoreAppPlaneStackProps extends cdk.StackProps {
  eventBusArn: string
  systemAdminEmail: string
  regApiGatewayUrl: string
}

export class CoreAppPlaneStack extends cdk.Stack {
  public readonly userInterface: UserInterface;
  public readonly tenantMappingTable: Table;
  constructor (scope: Construct, id: string, props: CoreAppPlaneStackProps) {
    super(scope, id, props);

    const systemAdminEmail = props.systemAdminEmail;

    this.tenantMappingTable = new Table(this, 'TenantMappingTable', {
      partitionKey: { name: 'tenantId', type: AttributeType.STRING }
    });

    const provisioningJobRunnerProps: sbt.CoreApplicationPlaneJobRunnerProps = {
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
      script: fs.readFileSync('../scripts/provision-tenant.sh', 'utf8'),
      outgoingEvent: sbt.DetailType.PROVISION_SUCCESS,
      incomingEvent: sbt.DetailType.ONBOARDING_REQUEST,

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

    const deprovisioningJobRunnerProps: sbt.CoreApplicationPlaneJobRunnerProps = {
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
      script: fs.readFileSync('../scripts/deprovision-tenant.sh', 'utf8'),
      environmentStringVariablesFromIncomingEvent: ['tenantId', 'tier'],
      environmentVariablesToOutgoingEvent: ['tenantStatus'],
      outgoingEvent: sbt.DetailType.DEPROVISION_SUCCESS,
      incomingEvent: sbt.DetailType.OFFBOARDING_REQUEST,

      scriptEnvironmentVariables: {
        TENANT_STACK_MAPPING_TABLE: this.tenantMappingTable.tableName,
        CDK_PARAM_SYSTEM_ADMIN_EMAIL: systemAdminEmail
      }
    };

    const eventBus = EventBus.fromEventBusArn(this, 'EventBus', props.eventBusArn);
    const eventManager = new sbt.EventManager(this, 'EventManager', {
      eventBus: eventBus,
    });

    new sbt.CoreApplicationPlane(this, 'coreappplane-sbt', {
      eventManager: eventManager,
      jobRunnerPropsList: [provisioningJobRunnerProps, deprovisioningJobRunnerProps]
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
