/**
 *  Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance
 *  with the License. A copy of the License is located at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions
 *  and limitations under the License.
 */

import { STSClient, AssumeRoleCommand } from "@aws-sdk/client-sts";
import * as jwt from "jsonwebtoken";
import { JwksClient } from "jwks-rsa";

/**
 * The Token Vending Machine library offers a solution for dynamically assuming an
 * ABAC role and obtaining tenant-scoped credentials. It conceals the intricacies
 * of managing and generating these scoped credentials. By utilizing these scoped credentials,
 * tenant isolation is enforced when accessing tenant-specific resources.
 */
export class TokenVendingMachine {
  private sts: STSClient;

  constructor() {
    this.sts = new STSClient();
  }

  private async validateJwt(
    jwtToken: string,
    idpDetails: string,
  ): Promise<jwt.JwtPayload | null> {
    const idpDetailsJson = JSON.parse(idpDetails);
    const issuer = idpDetailsJson.issuer;
    const audience = idpDetailsJson.audience;

    const client = new JwksClient({
      jwksUri: `${issuer}/.well-known/jwks.json`,
    });

    const decodedToken = jwt.decode(jwtToken, { complete: true });
    if (!decodedToken) {
      console.error("Decoding token has failed");
      return null;
    }

    const kid = decodedToken.header.kid;
    const key = await client.getSigningKey(kid);
    const signingKey = key.getPublicKey();

    try {
      const verifiedToken = jwt.verify(jwtToken, signingKey, {
        algorithms: ["RS256"],
        issuer: issuer,
        audience: audience,
      });
      if (
        typeof verifiedToken !== "object" ||
        verifiedToken.token_use !== "id" ||
        typeof verifiedToken["custom:tenantId"] !== "string" ||
        !Array.isArray(verifiedToken["cognito:groups"]) ||
        !verifiedToken["cognito:groups"].includes(
          verifiedToken["custom:tenantId"],
        )
      ) {
        return null;
      }
      return verifiedToken;
    } catch (error: any) {
      console.error("JWT validation failed");
      return null;
    }
  }

  private async getTemporaryCredentails(
    roleArn: string,
    requestTagKeysMappingAttributes: any,
    decodedToken: any,
    ttl: number,
  ): Promise<string> {
    try {
      const requestTagKeyValueArray = this.createRequestTagKeyValueArray(
        requestTagKeysMappingAttributes,
        decodedToken,
      );

      const command = new AssumeRoleCommand({
        RoleArn: roleArn,
        RoleSessionName: "AssumeRoleSession",
        DurationSeconds: ttl,
        Tags: requestTagKeyValueArray,
      });

      const response = await this.sts.send(command);
      if (!response.Credentials) {
        throw new Error("Temporary credentials not found");
      }
      const creds: string = JSON.stringify(response.Credentials);

      return creds;
    } catch (error: any) {
      console.error(
        `Error getting temporary credentials for role ${roleArn}:`,
        error,
      );
      throw error;
    }
  }

  private createRequestTagKeyValueArray(
    requestTagKeysMappingAttributes: any,
    decodedToken: any,
  ): any {
    const requestTagKeyValueArray: { Key: string; Value: string }[] = [];

    for (const key in requestTagKeysMappingAttributes) {
      const value = requestTagKeysMappingAttributes[key];
      const tagValue = decodedToken[value];
      if (typeof tagValue !== "string" || tagValue.length === 0) {
        throw new Error("Verified token is missing a required session tag claim");
      }
      requestTagKeyValueArray.push({ Key: key, Value: tagValue });
    }
    return requestTagKeyValueArray;
  }

  /**
   * This method is used to dynamically assume an ABAC role
   * which is provided through environment variables
   * and obtain temporary tenant-scoped credentials.It takes in a json web token and a time to live (ttl) in seconds as input.
   * It always validates the input ID token before deriving STS session tags.
   * It returns a json string containing the temporary tenant-scoped credentials.
   */
  public async assumeRole(jwtToken: string, ttl: number): Promise<string> {
    try {
      const idpDetails = process.env.IDP_DETAILS;
      if (!idpDetails) {
        throw new Error("IDP_DETAILS environment variable is not set");
      }
      const verifiedToken = await this.validateJwt(jwtToken, idpDetails);
      if (!verifiedToken) {
        throw new Error("Invalid JWT token");
      }

      const roleArn = process.env.IAM_ROLE_ARN;
      if (!roleArn) {
        throw new Error("IAM_ROLE_ARN environment variable is not set");
      }

      if (!process.env.REQUEST_TAG_KEYS_MAPPING_ATTRIBUTES) {
        throw new Error("REQUEST_TAG_KEYS environment variable is not set");
      }

      const requestTagKeysMappingAttributes = JSON.parse(
        process.env.REQUEST_TAG_KEYS_MAPPING_ATTRIBUTES,
      );

      return await this.getTemporaryCredentails(
        roleArn,
        requestTagKeysMappingAttributes,
        verifiedToken,
        ttl,
      );
    } catch (error: any) {
      console.error('Unable to obtain tenant-scoped credentials');
      throw error;
    }
  }
}