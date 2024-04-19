/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 */
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
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
  AdminAddUserToGroupCommand
} from '@aws-sdk/client-cognito-identity-provider';
import { UserInfo } from './entities/user.entity';

@Injectable()
export class UsersService {
  tableName: string = process.env.USER_TABLE_NAME;
  cognitoClient: CognitoIdentityProviderClient =
    new CognitoIdentityProviderClient({ region: process.env.AWS_REGION });

  userPoolId: string = process.env.COGNITO_USER_POOL_ID;

  async create (userDto: UserDto, tenant: any) {
    console.log('Creating user:', userDto);
    try {
      const command = new AdminCreateUserCommand({
        UserPoolId: this.userPoolId,
        Username: userDto.userName,
        DesiredDeliveryMediums: ['EMAIL'],
        UserAttributes: [
          {
            Name: 'email',
            Value: userDto.userEmail
          },
          {
            Name: 'email_verified',
            Value: 'true'
          },
          {
            Name: 'custom:userRole',
            Value: userDto.userRole
          },
          {
            Name: 'custom:tenantId',
            Value: tenant.tenantId
          },
          {
            Name: 'custom:tenantTier',
            Value: tenant.tenantTier
          }
        ]
      });
      let response = await this.cognitoClient.send(command);
      const input = {
        GroupName: tenant.tenantId, // required
        UserPoolId: this.userPoolId // required
      };
      try {
        response = await this.cognitoClient.send(new GetGroupCommand(input));
      } catch (error) {
        response = await this.cognitoClient.send(
          new CreateGroupCommand({
            ...input,
            Description: `${tenant.tenantId}'s group`,
            Precedence: Number(0)
          })
        );
      }
      response = await this.cognitoClient.send(
        new AdminAddUserToGroupCommand({
          ...input,
          Username: userDto.userName
        })
      );
      return JSON.stringify(response);
    } catch (error) {
      console.error(error);
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: error
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async findAll (tenantId: string) {
    console.log('Getting All Users for Tenant:', tenantId);
    try {
      const input = {
        UserPoolId: this.userPoolId, // required
        GroupName: tenantId // required
      };
      const command = new ListUsersInGroupCommand(input);
      const response = await this.cognitoClient.send(command);

      const users: UserInfo[] = [];
      for (let i = 0; i < response.Users.length; i++) {
        const user = {
          ...response.Users[i],
          Attributes: response.Users[i].Attributes.reduce(
            (acc, { Name, Value }) => ({ ...acc, [Name]: Value }),
            {}
          )
        };

        const userInfo = new UserInfo();
        const attributes = user['Attributes'];
        userInfo.username = user['Username'];
        userInfo.email = attributes['email'];
        userInfo.user_role = attributes['custom:userRole'];
        userInfo.status = user['UserStatus'];
        userInfo.enabled = user['Enabled'];
        userInfo.created = user['UserCreateDate'];
        userInfo.modified = user['UserLastModifiedDate'];
        users.push(userInfo);
      }
      return users;
    } catch (error) {
      console.error(error);
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: error
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async findOne (userName: string) {
    try {
      console.log('Getting User: ', userName);

      const input = {
        UserPoolId: this.userPoolId, // required
        Username: userName // required
      };
      const command = new AdminGetUserCommand(input);
      console.log('Getting one User for Tenant2');
      const response = await this.cognitoClient.send(command);

      return JSON.stringify(response);
    } catch (error) {
      console.error(error);
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: error
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async update (userName: string, updateUserDto: UpdateUserDto) {
    try {
      console.log('Updating User: ', userName);
      const input = {
        UserPoolId: this.userPoolId, // required
        Username: userName, // required
        UserAttributes: [
          {
            Name: 'email', // required
            Value: updateUserDto.userEmail
          },
          {
            Name: 'custom:userRole', // required
            Value: updateUserDto.userRole
          }
        ]
      };
      const command = new AdminUpdateUserAttributesCommand(input);
      const response = await this.cognitoClient.send(command);

      console.log('Update Response:', response);
      return JSON.stringify(updateUserDto);
    } catch (error) {
      console.error(error);
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: error
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  async delete (username: string) {
    try {
      console.log('Deleting User: ', username);

      const input = {
        UserPoolId: this.userPoolId, // required
        Username: username // required
      };
      const command = new AdminDeleteUserCommand(input);
      const response = await this.cognitoClient.send(command);

      return JSON.stringify(response);
    } catch (error) {
      console.error(error);
      throw new HttpException(
        {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: error
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
