/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  UseGuards,
  SetMetadata
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UserDto } from './dto/user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials } from '@app/auth/auth.decorator';

@Controller('users')
export class UsersController {
  constructor (private readonly usersService: UsersService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async create (@Body() userDto: UserDto, @TenantCredentials() tenant) {
    console.log('Request received to create new user', tenant.tenantTier);
    return await this.usersService.create(userDto, tenant);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll (@TenantCredentials() tenant) {
    return await this.usersService.findAll(tenant.tenantId);
  }

  @Get('/health')
  @UseGuards(JwtAuthGuard)
  @SetMetadata('isPublic', true)
  health () {
    return { status: 'ok' };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne (@Param('id') username: string, @TenantCredentials() tenant) {
    console.log('Get a user', tenant);
    return await this.usersService.findOne(username);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async update (
  @Param('id') username: string,
    @Body() updateUserDto: UpdateUserDto,
    @TenantCredentials() tenant
  ) {
    console.log(tenant);
    return await this.usersService.update(username, updateUserDto);
  }

  @Delete(':id')
  async remove (@Param('id') username: string) {
    return await this.usersService.delete(username);
  }
}
