/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 */
import {
  Controller, Get, Post, Body, Put, Param, UseGuards, SetMetadata
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials } from '@app/auth/auth.decorator';

@Controller('products')
export class ProductsController {
  constructor (private readonly productsService: ProductsService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async create (@Body() createProductDto: CreateProductDto, @TenantCredentials() tenant) {
    return await this.productsService.create(createProductDto, tenant.tenantId, tenant.tenantName);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll (@TenantCredentials() tenant) {
    return await this.productsService.findAll(tenant.tenantId, tenant.tenantName);
  }

  @Get('/health')
  @UseGuards(JwtAuthGuard)
  @SetMetadata('isPublic', true)
  health () { return { status: 'ok' }; }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne (@Param('id') id: string, @TenantCredentials() tenant) {
    return await this.productsService.findOne(id, tenant.tenantId, tenant.tenantName);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async update (@Param('id') id: string, @Body() updateProductDto: UpdateProductDto, @TenantCredentials() tenant) {
    return await this.productsService.update(id, tenant.tenantId, tenant.tenantName, updateProductDto);
  }
}
