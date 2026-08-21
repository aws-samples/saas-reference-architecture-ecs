import * as assert from 'node:assert/strict';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
// Explicit extension prevents Node from selecting an older generated module.
const { JwtStrategy } = require('../libs/auth/src/jwt.strategy.ts');
const { UsersService } = require(
  '../microservices/user/src/users/users.service.ts',
);

process.env.AWS_REGION = 'us-east-1';
process.env.COGNITO_USER_POOL_ID = 'us-east-1_Trusted123';

interface SentCommand {
  constructor: { name: string };
  input: Record<string, unknown>;
}

function serviceWithHandler(handler: (command: SentCommand) => Promise<any>) {
  const service = new UsersService();
  service.cognitoClient = { send: handler } as any;
  return service;
}

async function expectForbidden(action: () => Promise<unknown>): Promise<void> {
  await assert.rejects(action, (error: unknown) => error instanceof ForbiddenException);
}

async function run(): Promise<void> {
  const jwtStrategy = new JwtStrategy({
    authority: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Trusted123',
    clientId: 'trusted-client',
  } as any);
  await assert.rejects(
    () => jwtStrategy.validate({ token_use: 'access' }),
    (error: unknown) => error instanceof UnauthorizedException,
  );
  await assert.rejects(
    () => jwtStrategy.validate({
      token_use: 'id',
      sub: 'subject-1',
      iss: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Trusted123',
      aud: 'trusted-client',
      'cognito:username': 'tenant-user@example.com',
      'cognito:groups': ['tenant-2'],
      'custom:tenantId': 'tenant-1',
      'custom:tenantTier': 'Basic',
      'custom:userRole': 'TenantUser',
    }),
    (error: unknown) => error instanceof UnauthorizedException,
  );

  let sendCount = 0;
  const noCalls = serviceWithHandler(async () => {
    sendCount += 1;
    return {};
  });

  await expectForbidden(() => noCalls.create(
    {
      userEmail: 'new-user@example.com',
      userName: 'new-user@example.com',
      userRole: 'SystemAdmin',
    },
    'tenant-1',
    'Basic',
    'tenant-one',
    'TenantAdmin',
  ));
  assert.equal(sendCount, 0, 'forbidden provider role must fail before Cognito');

  await expectForbidden(() => noCalls.findAll('tenant-1', 'TenantUser'));
  assert.equal(sendCount, 0, 'TenantUser must not call user-management APIs');

  const crossTenantCommands: string[] = [];
  const crossTenant = serviceWithHandler(async (command) => {
    crossTenantCommands.push(command.constructor.name);
    if (command.constructor.name === 'AdminListGroupsForUserCommand') {
      return { Groups: [{ GroupName: 'tenant-2' }] };
    }
    throw new Error('cross-tenant target operation must not run');
  });

  await expectForbidden(() => crossTenant.findOne(
    'other-tenant-user@example.com', 'tenant-1', 'TenantAdmin'));
  await expectForbidden(() => crossTenant.update(
    'other-tenant-user@example.com',
    { userEmail: 'changed@example.com' },
    'tenant-1',
    'TenantAdmin',
  ));
  await expectForbidden(() => crossTenant.delete(
    'other-tenant-user@example.com', 'tenant-1', 'TenantAdmin'));
  assert.deepEqual(crossTenantCommands, [
    'AdminListGroupsForUserCommand',
    'AdminListGroupsForUserCommand',
    'AdminListGroupsForUserCommand',
  ]);

  const sameTenantCommands: string[] = [];
  const sameTenant = serviceWithHandler(async (command) => {
    sameTenantCommands.push(command.constructor.name);
    if (command.constructor.name === 'AdminListGroupsForUserCommand') {
      return { Groups: [{ GroupName: 'tenant-1' }] };
    }
    if (command.constructor.name === 'AdminGetUserCommand') {
      return { Username: 'tenant-user@example.com' };
    }
    return {};
  });

  const found = await sameTenant.findOne(
    'tenant-user@example.com', 'tenant-1', 'TenantAdmin');
  assert.equal(found.Username, 'tenant-user@example.com');
  assert.deepEqual(sameTenantCommands, [
    'AdminListGroupsForUserCommand',
    'AdminGetUserCommand',
  ]);

  console.log('user service security tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
