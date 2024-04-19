/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 */
import {
  type CredentialConfig,
  CredentialVendor,
  PolicyType
} from '@app/auth/credential-vendor';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ClientFactoryService {
  public async getClient (
    tenantId: string,
    credentialConfig?: CredentialConfig
  ) {
    const credentialVendor = new CredentialVendor(tenantId);
    const creds = await credentialVendor.getCredentials(
      credentialConfig || {
        policyType: PolicyType.DynamoDBLeadingKey,
        attributes: {
          tenant: tenantId
        }
      }
    );
    return DynamoDBDocumentClient.from(
      new DynamoDBClient({
        credentials: {
          accessKeyId: creds.AccessKeyId,
          secretAccessKey: creds.SecretAccessKey,
          sessionToken: creds.SessionToken,
          expiration: creds.Expiration
        }
      })
    );
  }
}
