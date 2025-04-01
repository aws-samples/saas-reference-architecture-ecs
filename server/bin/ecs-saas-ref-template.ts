#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { TenantTemplateStack } from '../lib/tenant-template/tenant-template-stack';
import { DestroyPolicySetter } from '../lib/utilities/destroy-policy-setter';
import { CoreAppPlaneStack } from '../lib/bootstrap-template/core-appplane-stack';
import { getEnv } from '../lib/utilities/helper-functions';
import { ControlPlaneStack } from '../lib/bootstrap-template/control-plane-stack';
import { SharedInfraStack } from '../lib/shared-infra/shared-infra-stack';
import { AwsSolutionsChecks } from 'cdk-nag';

const app = new cdk.App();
cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
//cdk.Aspects.of(app);
// required input parameters
if (!process.env.CDK_PARAM_SYSTEM_ADMIN_EMAIL) {
  throw new Error('Please provide system admin email');
}

if (!process.env.CDK_PARAM_TENANT_ID) {
  console.log('Tenant ID is empty, a default tenant id "basic" will be assigned');
}
const basicId = 'basic';
const AzCount = 3;
const basicName = 'basic';
if(AzCount < 2 || AzCount > 3) {
  throw new Error('Please Availability Zones count must be 2 or 3');
}
// required input parameters
const systemAdminEmail = process.env.CDK_PARAM_SYSTEM_ADMIN_EMAIL;
const tenantId = process.env.CDK_PARAM_TENANT_ID || basicId;
const tenantName = process.env.CDK_PARAM_TENANT_NAME || basicName;
const useFederation = process.env.CDK_PARAM_USE_FEDERATION || 'true';

const commitId = getEnv('CDK_PARAM_COMMIT_ID');
const tier = getEnv('CDK_PARAM_TIER');

if (!process.env.CDK_PARAM_SYSTEM_ADMIN_ROLE_NAME) {
  process.env.CDK_PARAM_SYSTEM_ADMIN_ROLE_NAME = 'SystemAdmin';
}
// default values for optional input parameters
const defaultStageName = 'prod';
const defaultApiKeyPremiumTierParameter = '508d335c-a768-4cfb-aaff-45a89129853c-sbt';
const defaultApiKeyAdvancedTierParameter = '49cbd97a-7499-4939-bc3d-b116ca479dda-sbt';
const defaultApiKeyBasicTierParameter = 'a6e257c3-a19d-4461-90a3-c998665a0d6b-sbt';
const defaultSystemAdminRoleName = 'SystemAdmin';

// optional input parameters
const systemAdminRoleName =
  process.env.CDK_PARAM_SYSTEM_ADMIN_ROLE_NAME || defaultSystemAdminRoleName;
const stageName = process.env.CDK_PARAM_STAGE || defaultStageName;


const apiKeyPremiumTierParameter =
  process.env.CDK_PARAM_API_KEY_PREMIUM_TIER_PARAMETER || defaultApiKeyPremiumTierParameter;
const apiKeyAdvancedTierParameter =
  process.env.CDK_PARAM_API_KEY_ADVANCED_TIER_PARAMETER || defaultApiKeyAdvancedTierParameter;
const apiKeyBasicTierParameter =
  process.env.CDK_PARAM_API_KEY_BASIC_TIER_PARAMETER || defaultApiKeyBasicTierParameter;
const isPooledDeploy = tenantId == basicId;
//A flag to check whether the Advanced cluster is exist.
//If not exist, value is INACTIVE.
const advancedCluster = process.env.CDK_ADV_CLUSTER || 'INACTIVE';

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
  }
};

const env = {
  account: app.account,
  region: app.region
}

const sharedInfraStack = new SharedInfraStack(app, 'shared-infra-stack', {
  ApiKeySSMParameterNames: apiKeySSMParameterNames,
  apiKeyPremiumTierParameter: apiKeyPremiumTierParameter,
  apiKeyAdvancedTierParameter: apiKeyAdvancedTierParameter,
  apiKeyBasicTierParameter: apiKeyBasicTierParameter,
  stageName: stageName,
  azCount: AzCount,
  env
});

const controlPlaneStack = new ControlPlaneStack(app, 'controlplane-stack', {
  systemAdminEmail: systemAdminEmail,
  accessLogsBucket: sharedInfraStack.accessLogsBucket,
  distro: sharedInfraStack.adminSiteDistro,
  adminSiteUrl: sharedInfraStack.adminSiteUrl,
  env
});

const coreAppPlaneStack = new CoreAppPlaneStack(app, 'core-appplane-stack', {
  systemAdminEmail: systemAdminEmail,
  regApiGatewayUrl: controlPlaneStack.regApiGatewayUrl,
  eventManager: controlPlaneStack.eventManager,
  accessLogsBucket: sharedInfraStack.accessLogsBucket,
  distro: sharedInfraStack.appSiteDistro,
  appSiteUrl: sharedInfraStack.appSiteUrl,
  tenantMappingTable: sharedInfraStack.tenantMappingTable,
  env,
});
cdk.Aspects.of(coreAppPlaneStack).add(new DestroyPolicySetter());

const tenantTemplateStack = new TenantTemplateStack(app, `tenant-template-stack-${tenantId}`, {
  tenantId: tenantId,
  tenantName: tenantName,
  stageName: stageName,
  tenantMappingTable: sharedInfraStack.tenantMappingTable,
  commitId: commitId,
  tier: tier,
  advancedCluster: advancedCluster,
  appSiteUrl: sharedInfraStack.appSiteUrl,
  useFederation: useFederation,
  env
});

const advancedTierTempStack = new TenantTemplateStack(app, `tenant-template-stack-advanced`, {
  tenantId: 'advanced',
  tenantName: tenantName,
  stageName: stageName,
  tenantMappingTable: sharedInfraStack.tenantMappingTable,
  commitId: commitId,
  tier: 'advanced',
  advancedCluster: 'INACTIVE',
  appSiteUrl: sharedInfraStack.appSiteUrl,
  useFederation: useFederation,
  env
});
tenantTemplateStack.addDependency(sharedInfraStack);
advancedTierTempStack.addDependency(sharedInfraStack);

cdk.Tags.of(tenantTemplateStack).add('TenantId', tenantId);
cdk.Tags.of(tenantTemplateStack).add('TenantName', tenantName);

cdk.Aspects.of(tenantTemplateStack).add(new DestroyPolicySetter());
