/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  SetMetadata,
  Req
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { TenantCredentials } from '@app/auth/auth.decorator';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';

@Controller('orders')
export class OrdersController {
  constructor (private readonly ordersService: OrdersService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async create (@Body() createOrderDto: CreateOrderDto, @TenantCredentials() tenant, @Req() req) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    await this.ordersService.create(createOrderDto, tenant.tenantId, jwtToken);
  }

  @Get('/health')
  @UseGuards(JwtAuthGuard)
  @SetMetadata('isPublic', true)
  health () {
    return { status: 'ok' };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll (@TenantCredentials() tenant, @Req() req) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.ordersService.findAll(tenant?.tenantId, jwtToken);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne (@Param('id') id: string, @TenantCredentials() tenant, @Req() req) {
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.ordersService.findOne(id, tenant?.tenantId, jwtToken);
  }
}
