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
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UserDto } from './dto/user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials } from '@app/auth/auth.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  async create(@Body() userDto: UserDto, @TenantCredentials() tenant) {
    return await this.usersService.create(
      userDto,
      tenant.tenantId,
      tenant.tenantTier,
      tenant.tenantName,
      tenant.userRole,
    );
  }

  @Get()
  async findAll(@TenantCredentials() tenant) {
    return await this.usersService.findAll(tenant.tenantId, tenant.userRole);
  }

  @Get('/health')
  health() {
    return { status: 'ok' };
  }

  @Get(':id')
  async findOne(
    @Param('id') username: string,
    @TenantCredentials() tenant,
  ) {
    return await this.usersService.findOne(
      username, tenant.tenantId, tenant.userRole);
  }

  @Put(':id')
  async update(
    @Param('id') username: string,
    @Body() updateUserDto: UpdateUserDto,
    @TenantCredentials() tenant,
  ) {
    return await this.usersService.update(
      username, updateUserDto, tenant.tenantId, tenant.userRole);
  }

  @Delete(':id')
  async remove(
    @Param('id') username: string,
    @TenantCredentials() tenant,
  ) {
    return await this.usersService.delete(
      username, tenant.tenantId, tenant.userRole);
  }
}
