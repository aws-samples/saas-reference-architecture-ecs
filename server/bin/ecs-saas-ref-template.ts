#!/usr/bin/env node
import 'dotenv/config';
import * as cdk from 'aws-cdk-lib';
import { TenantTemplateStack } from '../lib/tenant-template/tenant-template-stack';
import { DestroyPolicySetter } from '../lib/utilities/destroy-policy-setter';
import { CoreAppPlaneStack } from '../lib/bootstrap-template/core-appplane-stack';
import { getEnv } from '../lib/utilities/helper-functions';
import { ControlPlaneStack } from '../lib/bootstrap-template/control-plane-stack';
import { SharedInfraStack } from '../lib/shared-infra/shared-infra-stack';
import { AwsSolutionsChecks } from 'cdk-nag';

const app = new cdk.App();

// Enable CDK Nag (controlled by environment variable)
if (process.env.CDK_NAG_ENABLED === 'true') {
  cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
}
console.log('CDK NAG: ', process.env.CDK_NAG_ENABLED || 'false');

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
  throw new Error('Availability Zones count must be between 2 and 3 (inclusive). Current value: ' + AzCount);
}
// required input parameters
const systemAdminEmail = process.env.CDK_PARAM_SYSTEM_ADMIN_EMAIL;
const tenantId = process.env.CDK_PARAM_TENANT_ID || basicId;
const tenantName = process.env.CDK_PARAM_TENANT_NAME || basicName;
const useFederation = process.env.CDK_PARAM_USE_FEDERATION || 'true';

const commitId = getEnv('CDK_PARAM_COMMIT_ID');
const tier = getEnv('CDK_PARAM_TIER');

// Determine useEc2 based on tier using environment variables directly
const useEc2 = tier === 'PREMIUM' ? process.env.CDK_PARAM_USE_EC2_PREMIUM === 'true' :
              tier === 'ADVANCED' ? process.env.CDK_PARAM_USE_EC2_ADVANCED === 'true' :
              process.env.CDK_PARAM_USE_EC2_BASIC === 'true';
const useRProxy = process.env.CDK_PARAM_USE_RPROXY !== 'false';

// default values for optional input parameters
const defaultStageName = 'prod';

// optional input parameters
const stageName = process.env.CDK_PARAM_STAGE || defaultStageName;

//A flag to check whether the Advanced cluster is exist.
//If not exist, value is INACTIVE.
const advancedCluster = process.env.CDK_ADV_CLUSTER || 'INACTIVE';

const env = {
  account: app.account,
  region: app.region
};

const sharedInfraStack = new SharedInfraStack(app, 'shared-infra-stack', {
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
  regApiGatewayUrl: controlPlaneStack.regApiGatewayUrl,
  appApiUrl: sharedInfraStack.apiGateway.restApi.url,
  eventManager: controlPlaneStack.eventManager,
  auth: controlPlaneStack.auth, // Add auth information
  accessLogsBucket: sharedInfraStack.accessLogsBucket,
  distro: sharedInfraStack.appSiteDistro,
  appSiteUrl: sharedInfraStack.appSiteUrl,
  tenantMappingTable: sharedInfraStack.tenantMappingTable,
  env
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
  useEc2: useEc2, // Use tier-specific setting
  useRProxy: useRProxy,
  env
});

tenantTemplateStack.addDependency(sharedInfraStack);

cdk.Tags.of(tenantTemplateStack).add('TenantId', tenantId);
cdk.Tags.of(tenantTemplateStack).add('TenantName', tenantName);

cdk.Aspects.of(tenantTemplateStack).add(new DestroyPolicySetter());
