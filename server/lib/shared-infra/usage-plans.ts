import { Construct } from 'constructs';
import { ApiKey, Period, type RestApi, type SpecRestApi, type UsagePlan } from 'aws-cdk-lib/aws-apigateway';
import { addTemplateTag } from '../utilities/helper-functions';

interface UsagePlansProps {
  apiGateway: SpecRestApi
  apiKeyIdBasicTier: string
  apiKeyIdAdvancedTier: string
  apiKeyIdPremiumTier: string
}

export class UsagePlans extends Construct {
  public readonly usagePlanBasicTier: UsagePlan;
  public readonly usagePlanAdvancedTier: UsagePlan;
  public readonly usagePlanPremiumTier: UsagePlan;
  public readonly usagePlanSystemAdmin: UsagePlan;
  constructor (scope: Construct, id: string, props: UsagePlansProps) {
    super(scope, id);
    addTemplateTag(this, 'UsagePlans');
    this.usagePlanBasicTier = props.apiGateway.addUsagePlan('UsagePlanBasicTier', {
      quota: {
        limit: 1000,
        period: Period.DAY
      },
      throttle: {
        burstLimit: 10,
        rateLimit: 10
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
        burstLimit: 15,
        rateLimit: 15
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

  }
}
