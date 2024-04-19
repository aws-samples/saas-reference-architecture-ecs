/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 */
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuthModule } from '@app/auth';
import { ConfigModule } from '@nestjs/config';
import { ClientFactoryModule } from '@app/client-factory';

@Module({
  imports: [
    AuthModule,
    ConfigModule.forRoot({ isGlobal: true }),
    ClientFactoryModule
  ],
  controllers: [UsersController],
  providers: [UsersService]
})
export class UsersModule {}
