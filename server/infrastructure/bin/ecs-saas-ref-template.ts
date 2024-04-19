#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { TenantTemplateStack } from '../lib/tenant-template/tenant-template-stack';
import { DestroyPolicySetter } from '../lib/utilities/destroy-policy-setter';
import { CoreAppPlaneStack } from '../lib/bootstrap-template/core-app-plane-stack';
import { TenantUpdatePipeline } from '../lib/tenant-template/tenant-update-stack';
import { getEnv } from '../lib/utilities/helper-functions';
import { ControlPlaneStack } from '../lib/bootstrap-template/control-plane-stack';
import { SharedInfraStack } from '../lib/sharedinfra-template/shared-infra-stack';
import { AwsSolutionsChecks } from 'cdk-nag';

const app = new cdk.App();
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
// required input parameters
if (!process.env.CDK_PARAM_SYSTEM_ADMIN_EMAIL) {
  throw new Error('Please provide system admin email');
}

if (!process.env.CDK_PARAM_TENANT_ID) {
  console.log('Tenant ID is empty, a default tenant id "basic" will be assigned');
}
const basicId = 'basic';

// required input parameters
const systemAdminEmail = process.env.CDK_PARAM_SYSTEM_ADMIN_EMAIL;
const tenantId = process.env.CDK_PARAM_TENANT_ID || basicId;
const codeCommitRepositoryName = getEnv('CDK_PARAM_CODE_COMMIT_REPOSITORY_NAME');
const controlPlaneEventSource = getEnv('CDK_PARAM_CONTROL_PLANE_SOURCE');

const applicationPlaneEventSource = getEnv('CDK_PARAM_APPLICATION_NAME_PLANE_SOURCE');
const commitId = getEnv('CDK_PARAM_COMMIT_ID');
const tier = getEnv('CDK_PARAM_TIER');

if (!process.env.CDK_PARAM_IDP_NAME) {
  process.env.CDK_PARAM_IDP_NAME = 'COGNITO';
}
if (!process.env.CDK_PARAM_SYSTEM_ADMIN_ROLE_NAME) {
  process.env.CDK_PARAM_SYSTEM_ADMIN_ROLE_NAME = 'SystemAdmin';
}

// default values for optional input parameters
const defaultStageName = 'prod';
const defaultLambdaReserveConcurrency = '1';
const defaultLambdaCanaryDeploymentPreference = 'True';
const defaultApiKeyPlatinumTierParameter = '34135b26-7704-4ebc-adcc-9e0c604d4f04-sbt';
const defaultApiKeyPremiumTierParameter = '508d335c-a768-4cfb-aaff-45a89129853c-sbt';
const defaultApiKeyAdvancedTierParameter = '49cbd97a-7499-4939-bc3d-b116ca479dda-sbt';
const defaultApiKeyBasicTierParameter = 'a6e257c3-a19d-4461-90a3-c998665a0d6b-sbt';
const defaultIdpName = 'COGNITO';
const defaultSystemAdminRoleName = 'SystemAdmin';

// optional input parameters
const idpName = process.env.CDK_PARAM_IDP_NAME || defaultIdpName;
const systemAdminRoleName =
  process.env.CDK_PARAM_SYSTEM_ADMIN_ROLE_NAME || defaultSystemAdminRoleName;
const stageName = process.env.CDK_PARAM_STAGE_NAME || defaultStageName;
const lambdaReserveConcurrency = Number(
  process.env.CDK_PARAM_LAMBDA_RESERVE_CONCURRENCY || defaultLambdaReserveConcurrency
);
const lambdaCanaryDeploymentPreference =
  process.env.CDK_PARAM_LAMBDA_CANARY_DEPLOYMENT_PREFERENCE ||
  defaultLambdaCanaryDeploymentPreference;
const apiKeyPlatinumTierParameter =
  process.env.CDK_PARAM_API_KEY_PLATINUM_TIER_PARAMETER || defaultApiKeyPlatinumTierParameter;
const apiKeyPremiumTierParameter =
  process.env.CDK_PARAM_API_KEY_PREMIUM_TIER_PARAMETER || defaultApiKeyPremiumTierParameter;
const apiKeyAdvancedTierParameter =
  process.env.CDK_PARAM_API_KEY_ADVANCED_TIER_PARAMETER || defaultApiKeyAdvancedTierParameter;
const apiKeyBasicTierParameter =
  process.env.CDK_PARAM_API_KEY_BASIC_TIER_PARAMETER || defaultApiKeyBasicTierParameter;
const isPooledDeploy = tenantId == basicId;

// parameter names to facilitate sharing api keys
// between the bootstrap template and the tenant template stack(s)
const apiKeySSMParameterNames = {
  basic: {
    keyId: 'apiKeyBasicTierKeyId',
    value: 'apiKeyBasicTierValue'
  },
  advanced: {
    keyId: 'apiKeyAdvancedTierKeyId',
    value: 'apiKeyAdvancedTierValue'
  },
  premium: {
    keyId: 'apiKeyPremiumTierKeyId',
    value: 'apiKeyPremiumTierValue'
  },
  platinum: {
    keyId: 'apiKeyPlatinumTierKeyId',
    value: 'apiKeyPlatinumTierValue'
  }
};

const controlPlaneStack = new ControlPlaneStack(app, 'controlplane-stack', {
  idpName: idpName,
  systemAdminEmail: systemAdminEmail,
  systemAdminRoleName: systemAdminRoleName,
  controlPlaneEventSource: controlPlaneEventSource,
  applicationPlaneEventSource: applicationPlaneEventSource,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});

const coreAppPlaneStack = new CoreAppPlaneStack(app, 'coreappplane-stack', {
  systemAdminEmail: systemAdminEmail,
  regApiGatewayUrl: controlPlaneStack.regApiGatewayUrl,
  eventBusArn: controlPlaneStack.eventBusArn,
  apiKeyPlatinumTierParameter: apiKeyPlatinumTierParameter,
  apiKeyPremiumTierParameter: apiKeyPremiumTierParameter,
  apiKeyAdvancedTierParameter: apiKeyAdvancedTierParameter,
  apiKeyBasicTierParameter: apiKeyBasicTierParameter,
  ApiKeySSMParameterNames: apiKeySSMParameterNames,
  controlPlaneEventSource: controlPlaneEventSource,
  applicationPlaneEventSource: applicationPlaneEventSource,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});
cdk.Aspects.of(coreAppPlaneStack).add(new DestroyPolicySetter());

const sharedInfraStack = new SharedInfraStack(app, 'shared-infra-stack', {
  isPooledDeploy: isPooledDeploy,
  ApiKeySSMParameterNames: apiKeySSMParameterNames,
  stageName: stageName,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});
sharedInfraStack.addDependency(coreAppPlaneStack);

const tenantTemplateStack = new TenantTemplateStack(app, `tenant-template-stack-${tenantId}`, {
  tenantId: tenantId,
  stageName: stageName,
  lambdaReserveConcurrency: lambdaReserveConcurrency,
  lambdaCanaryDeploymentPreference: lambdaCanaryDeploymentPreference,
  isPooledDeploy: isPooledDeploy,
  ApiKeySSMParameterNames: apiKeySSMParameterNames,
  tenantMappingTable: coreAppPlaneStack.tenantMappingTable,
  commitId: commitId,
  tier: tier,
  appSiteUrl: coreAppPlaneStack.userInterface.appSiteUrl,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});
tenantTemplateStack.addDependency(sharedInfraStack);
cdk.Tags.of(tenantTemplateStack).add('TenantId', tenantId);
cdk.Tags.of(tenantTemplateStack).add('IsPooledDeploy', String(isPooledDeploy));
cdk.Aspects.of(tenantTemplateStack).add(new DestroyPolicySetter());

const ecsSaaSPipeline = new TenantUpdatePipeline(app, 'tenant-update-stack', {
  tenantMappingTable: coreAppPlaneStack.tenantMappingTable,
  codeCommitRepositoryName: codeCommitRepositoryName,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION
  }
});
cdk.Aspects.of(ecsSaaSPipeline).add(new DestroyPolicySetter());
