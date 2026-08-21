/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 */
import { ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { type UserDto } from './dto/user.dto';
import { type UpdateUserDto } from './dto/update-user.dto';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  ListUsersInGroupCommand,
  AdminDeleteUserCommand,
  AdminUpdateUserAttributesCommand,
  GetGroupCommand,
  CreateGroupCommand,
  AdminAddUserToGroupCommand,
  AdminListGroupsForUserCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { UserInfo } from './entities/user.entity';

@Injectable()
export class UsersService {
  cognitoClient: CognitoIdentityProviderClient =
    new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });

  userPoolId: string = process.env.COGNITO_USER_POOL_ID;

  private readonly assignableRoles = new Set(['TenantAdmin', 'TenantUser']);

  private assertCanManageUsers(actorRole: string): void {
    // Provider-level roles are intentionally not accepted from tenant pools.
    // Provider administration belongs to the separate control-plane boundary.
    if (actorRole !== 'TenantAdmin') {
      throw new ForbiddenException('User management requires TenantAdmin');
    }
  }

  private async assertUserInTenant(userName: string, tenantId: string): Promise<void> {
    try {
      const response = await this.cognitoClient.send(
        new AdminListGroupsForUserCommand({
          UserPoolId: this.userPoolId,
          Username: userName,
        })
      );
      const belongsToTenant = (response.Groups || [])
        .some((group) => group.GroupName === tenantId);
      if (!belongsToTenant) {
        throw new ForbiddenException('User does not belong to this tenant');
      }
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      // Avoid leaking whether a username exists in another tenant.
      throw new ForbiddenException('User does not belong to this tenant');
    }
  }

  async create(
    userDto: UserDto,
    tenantId: string,
    tenantTier: string,
    tenantName: string,
    actorRole: string,
  ) {
    this.assertCanManageUsers(actorRole);
    const requestedRole = userDto.userRole || 'TenantUser';
    if (!this.assignableRoles.has(requestedRole)) {
      throw new ForbiddenException('Role cannot be assigned by a tenant administrator');
    }
    try {
      await this.cognitoClient.send(
        new AdminCreateUserCommand({
          UserPoolId: this.userPoolId,
          Username: userDto.userEmail,
          DesiredDeliveryMediums: ['EMAIL'],
          UserAttributes: [
            { Name: 'email', Value: userDto.userEmail },
            { Name: 'email_verified', Value: 'true' },
            { Name: 'custom:tenantId', Value: tenantId },
            { Name: 'custom:userRole', Value: requestedRole },
            { Name: 'custom:tenantTier', Value: tenantTier },
            { Name: 'custom:tenantName', Value: tenantName },
          ],
        })
      );

      // Ensure tenant group exists
      const groupInput = { GroupName: tenantId, UserPoolId: this.userPoolId };
      try {
        await this.cognitoClient.send(new GetGroupCommand(groupInput));
      } catch {
        await this.cognitoClient.send(
          new CreateGroupCommand({
            ...groupInput,
            Description: `${tenantId}'s group`,
            Precedence: 0,
          })
        );
      }

      await this.cognitoClient.send(
        new AdminAddUserToGroupCommand({
          ...groupInput,
          Username: userDto.userEmail,
        })
      );

      return { message: 'User created successfully' };
    } catch {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'User management operation failed',
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async findAll(tenantId: string, actorRole: string) {
    this.assertCanManageUsers(actorRole);
    try {
      // Ensure tenant group exists before listing
      try {
        await this.cognitoClient.send(
          new GetGroupCommand({ GroupName: tenantId, UserPoolId: this.userPoolId })
        );
      } catch {
        // Group doesn't exist yet — return empty list
        return [];
      }

      const response = await this.cognitoClient.send(
        new ListUsersInGroupCommand({
          UserPoolId: this.userPoolId,
          GroupName: tenantId,
        })
      );

      const users: UserInfo[] = [];
      for (const user of response.Users || []) {
        const attrs = (user.Attributes || []).reduce(
          (acc, { Name, Value }) => ({ ...acc, [Name]: Value }),
          {} as Record<string, string>
        );

        const userInfo = new UserInfo();
        userInfo.username = user.Username;
        userInfo.email = attrs['email'];
        userInfo.user_role = attrs['custom:userRole'];
        userInfo.status = user.UserStatus;
        userInfo.enabled = user.Enabled;
        userInfo.created = user.UserCreateDate;
        userInfo.modified = user.UserLastModifiedDate;
        users.push(userInfo);
      }
      return users;
    } catch {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'User management operation failed',
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async findOne(userName: string, tenantId: string, actorRole: string) {
    this.assertCanManageUsers(actorRole);
    await this.assertUserInTenant(userName, tenantId);
    try {
      const response = await this.cognitoClient.send(
        new AdminGetUserCommand({
          UserPoolId: this.userPoolId,
          Username: userName,
        })
      );
      return response;
    } catch {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'User management operation failed',
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async update(
    userName: string,
    updateUserDto: UpdateUserDto,
    tenantId: string,
    actorRole: string,
  ) {
    this.assertCanManageUsers(actorRole);
    await this.assertUserInTenant(userName, tenantId);
    try {
      await this.cognitoClient.send(
        new AdminUpdateUserAttributesCommand({
          UserPoolId: this.userPoolId,
          Username: userName,
          UserAttributes: [
            { Name: 'email', Value: updateUserDto.userEmail },
          ],
        })
      );
      return updateUserDto;
    } catch {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'User management operation failed',
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async delete(username: string, tenantId: string, actorRole: string) {
    this.assertCanManageUsers(actorRole);
    await this.assertUserInTenant(username, tenantId);
    try {
      await this.cognitoClient.send(
        new AdminDeleteUserCommand({
          UserPoolId: this.userPoolId,
          Username: username,
        })
      );
      return { message: 'User deleted successfully' };
    } catch {
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'User management operation failed',
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
