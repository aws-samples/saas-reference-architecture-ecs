import { Construct } from 'constructs';
import { ApiKey } from 'aws-cdk-lib/aws-apigateway';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { addTemplateTag } from '../utilities/helper-functions';

interface TenantApiKeyProps {
  apiKeyValue: string
  ssmParameterApiKeyIdName: string
  ssmParameterApiValueName: string
}

export class TenantApiKey extends Construct {
  apiKey: ApiKey;
  apiKeyValue: string;
  constructor (scope: Construct, id: string, props: TenantApiKeyProps) {
    super(scope, id);
    addTemplateTag(this, 'TenantApiKey');
    this.apiKeyValue = props.apiKeyValue;

    this.apiKey = new ApiKey(this, 'apiKey', {
      value: props.apiKeyValue
    });
    new StringParameter(this, 'apiKeyId', {
      parameterName: props.ssmParameterApiKeyIdName,
      stringValue: this.apiKey.keyId
    });

    new StringParameter(this, 'apiKeyValue', {
      parameterName: props.ssmParameterApiValueName,
      stringValue: this.apiKeyValue
    });
  }
}
