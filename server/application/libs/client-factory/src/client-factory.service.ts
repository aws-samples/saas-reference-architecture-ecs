/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Injectable } from '@nestjs/common';
import { TokenVendingMachine } from '@app/auth/token-vending-machine';


@Injectable()
export class ClientFactoryService {
  public async getClient (
    tenantId: string,
    jwtToken: string
  ) {
    const tvm = new TokenVendingMachine(false);
    const credsJson = await tvm.assumeRole(jwtToken, 3600);
    const creds = JSON.parse(credsJson);
    
    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
    
    return DynamoDBDocumentClient.from(
      new DynamoDBClient({
        region: region,
        credentials: {
          accessKeyId: creds.AccessKeyId,
          secretAccessKey: creds.SecretAccessKey,
          sessionToken: creds.SessionToken
          // Omit expiration to avoid TypeError
        }
      })
    );
  }
}
