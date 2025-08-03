#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { TenantTemplateStack } from '../lib/tenant-template/tenant-template-stack-parallel';
import { SharedInfraStack } from '../lib/shared-infra/shared-infra-stack';
import { BootstrapTemplateStack } from '../lib/bootstrap-template/bootstrap-template-stack';
import { ApiKeySSMParameterNames } from '../lib/interfaces/api-key-ssm-parameter-names';
import { CoreAppPlaneStack } from '../lib/core-app-plane/core-app-plane-stack';
import { ControlPlaneStack } from '../lib/control-plane/control-plane-stack';

const app = new cdk.App();

const apiKeySSMParameterNames: ApiKeySSMParameterNames = {
  basic: {
    keyId: '/sbt-ecs/basic/api-key-id',
    value: '/sbt-ecs/basic/api-key-value'
  },
  advanced: {
    keyId: '/sbt-ecs/advanced/api-key-id',
    value: '/sbt-ecs/advanced/api-key-value'
  },
  premium: {
    keyId: '/sbt-ecs/premium/api-key-id',
    value: '/sbt-ecs/premium/api-key-value'
  }
};

const stageName = app.node.tryGetContext('stageName') || 'dev';
const tenantId = app.node.tryGetContext('tenantId') || 'tenant1';
const tenantName = app.node.tryGetContext('tenantName') || 'tenant1';
const commitId = app.node.tryGetContext('commitId') || 'local';
const waveNumber = app.node.tryGetContext('waveNumber') || '1';
const tier = app.node.tryGetContext('tier') || 'basic';
const advancedCluster = app.node.tryGetContext('advancedCluster') || 'INACTIVE';
const useFederation = app.node.tryGetContext('useFederation') || 'false';
const adminEmail = app.node.tryGetContext('adminEmail') || 'admin@example.com';
const azCount = app.node.tryGetContext('azCount') || 2;

const sharedInfraStack = new SharedInfraStack(app, 'shared-infra-stack', {
  stageName,
  ApiKeySSMParameterNames: apiKeySSMParameterNames,
  apiKeyBasicTierParameter: 'basic-tier-api-key',
  apiKeyAdvancedTierParameter: 'advanced-tier-api-key',
  apiKeyPremiumTierParameter: 'premium-tier-api-key',
  azCount: Number(azCount),
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
});

const bootstrapTemplateStack = new BootstrapTemplateStack(app, 'bootstrap-template-stack', {
  stageName,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
});

const controlPlaneStack = new ControlPlaneStack(app, 'controlplane-stack', {
  stageName,
  adminEmail,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
});

const coreAppPlaneStack = new CoreAppPlaneStack(app, 'coreappplane-stack', {
  stageName,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
});

const tenantTemplateStack = new TenantTemplateStack(app, `tenant-template-${tier}-${tenantId}`, {
  stageName,
  tenantId,
  tenantName,
  tenantMappingTable: sharedInfraStack.tenantMappingTable,
  commitId,
  waveNumber,
  tier,
  advancedCluster,
  appSiteUrl: sharedInfraStack.appSiteUrl,
  useFederation,
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
});

tenantTemplateStack.addDependency(sharedInfraStack);
bootstrapTemplateStack.addDependency(sharedInfraStack);
coreAppPlaneStack.addDependency(controlPlaneStack);
