/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 */
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import * as Mustache from 'mustache';
import * as policies from './policies.json';

export enum PolicyType {
  DynamoDBLeadingKey = 'DYNAMOLEADINGKEY'
}

export interface CredentialConfig {
  policyType: PolicyType
  attributes: ClientAttributes
  duration?: number
  roleSessionName?: string
}

export type ClientAttributes = Record<string, any>;

export class CredentialVendor {
  constructor (private readonly tenantId: string) {}

  async getCredentials (config: CredentialConfig): Promise<any> {
    let policy: string;
    switch (config.policyType) {
      case PolicyType.DynamoDBLeadingKey:
        const template = JSON.stringify(policies.dynamodbLeadingKey);
        const vals = {
          ...config.attributes,
          tenant: this.tenantId
        };
        policy = Mustache.render(template, vals);
        console.log('POLICY:', policy);
      default:
        break;
    }
    const sts = new STSClient({ region: process.env.AWS_REGION });
    const cmd = new AssumeRoleCommand({
      DurationSeconds: config.duration || 900,
      Policy: policy,
      RoleArn: process.env.IAM_ROLE_ARN,
      RoleSessionName: config.roleSessionName || this.tenantId
    });
    const response = await sts.send(cmd);
    console.log('Successfully assumed role: ', process.env.IAM_ROLE_ARN);
    return response.Credentials;
  }
}
