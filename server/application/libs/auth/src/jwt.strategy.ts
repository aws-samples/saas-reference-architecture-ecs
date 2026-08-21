/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 */
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { passportJwtSecret } from 'jwks-rsa';
import { AuthConfig } from './auth-config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor (private readonly authConfig: AuthConfig) {
    super({
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${authConfig.authority}/.well-known/jwks.json`
      }),

      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      audience: authConfig.clientId,
      issuer: authConfig.authority,
      algorithms: ['RS256']
    });

    console.log(authConfig.authority);
  }

  async validate (payload: any) {
    const requiredClaims = [
      payload.sub,
      payload.iss,
      payload.aud,
      payload['cognito:username'],
      payload['custom:tenantId'],
      payload['custom:tenantTier'],
      payload['custom:userRole']
    ];
    if (
      payload.token_use !== 'id' ||
      requiredClaims.some(value => typeof value !== 'string' || value.length === 0) ||
      !Array.isArray(payload['cognito:groups']) ||
      !payload['cognito:groups'].includes(payload['custom:tenantId'])
    ) {
      throw new UnauthorizedException('Invalid Cognito ID token claims');
    }
    const match = payload.iss.match(/([a-z\d\_\-]+)(\/*|)$/gi);
    return {
      userId: payload.sub,
      username: payload['cognito:username'],
      tenantId: payload['custom:tenantId'],
      tenantTier: payload['custom:tenantTier'],
      tenantName: payload['custom:tenantName'],
      userRole: payload['custom:userRole'],
      email: payload.email,
      userPoolId: match?.[0],
      appClientId: payload.aud
    };
  }
}
