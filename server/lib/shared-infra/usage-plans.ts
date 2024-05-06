import { Construct } from 'constructs';
import { ApiKey, Period, type RestApi, type UsagePlan } from 'aws-cdk-lib/aws-apigateway';

interface UsagePlansProps {
  apiGateway: RestApi
  apiKeyIdBasicTier: string
  apiKeyIdAdvancedTier: string
  apiKeyIdPremiumTier: string
  apiKeyIdPlatinumTier: string
  isPooledDeploy: boolean
}

export class UsagePlans extends Construct {
  public readonly usagePlanBasicTier: UsagePlan;
  public readonly usagePlanAdvancedTier: UsagePlan;
  public readonly usagePlanPremiumTier: UsagePlan;
  public readonly usagePlanPlatinumTier: UsagePlan;
  public readonly usagePlanSystemAdmin: UsagePlan;
  constructor (scope: Construct, id: string, props: UsagePlansProps) {
    super(scope, id);

    this.usagePlanBasicTier = props.apiGateway.addUsagePlan('UsagePlanBasicTier', {
      quota: {
        limit: 1000,
        period: Period.DAY
      },
      throttle: {
        burstLimit: 50,
        rateLimit: 50
      }
    });

    this.usagePlanBasicTier.addApiKey(
      ApiKey.fromApiKeyId(this, 'ApiKeyBasic', props.apiKeyIdBasicTier)
    );

    this.usagePlanAdvancedTier = props.apiGateway.addUsagePlan('UsagePlanAdvancedTier', {
      quota: {
        limit: 2000,
        period: Period.DAY
      },
      throttle: {
        burstLimit: 100,
        rateLimit: 75
      }
    });

    this.usagePlanAdvancedTier.addApiKey(
      ApiKey.fromApiKeyId(this, 'ApiKeyAdvanced', props.apiKeyIdAdvancedTier)
    );

    this.usagePlanPremiumTier = props.apiGateway.addUsagePlan('UsagePlanPremiumTier', {
      quota: {
        limit: 6000,
        period: Period.DAY
      },
      throttle: {
        burstLimit: 300,
        rateLimit: 300
      }
    });

    this.usagePlanPremiumTier.addApiKey(
      ApiKey.fromApiKeyId(this, 'ApiKeyPremium', props.apiKeyIdPremiumTier)
    );

    for (const usagePlanTier of [
      this.usagePlanBasicTier,
      this.usagePlanAdvancedTier,
      this.usagePlanPremiumTier
    ]) {
      usagePlanTier.addApiStage({
        api: props.apiGateway,
        stage: props.apiGateway.deploymentStage
      });
    }
    this.usagePlanPlatinumTier = props.apiGateway.addUsagePlan('UsagePlanPlatinumTier', {
      quota: {
        limit: 6500,
        period: Period.DAY
      },
      throttle: {
        burstLimit: 450,
        rateLimit: 450
      }
    });

    this.usagePlanPlatinumTier.addApiKey(
      ApiKey.fromApiKeyId(this, 'ApiKeyPlatinum', props.apiKeyIdPlatinumTier)
    );
    this.usagePlanPlatinumTier.addApiStage({
      api: props.apiGateway,
      stage: props.apiGateway.deploymentStage
    });
  }
}
