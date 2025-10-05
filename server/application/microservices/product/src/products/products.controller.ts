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
  UseGuards,
  SetMetadata,
  Req
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
  async create (
  @Body() createProductDto: CreateProductDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    console.log('Create product', tenant);
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    await this.productsService.create(createProductDto, tenant.tenantId, jwtToken);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll (@TenantCredentials() tenant, @Req() req) {
    console.log('Get products', tenant);
    const tenantId = tenant.tenantId;
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.productsService.findAll(tenantId, jwtToken);
  }

  @Get('/health')
  @UseGuards(JwtAuthGuard)
  @SetMetadata('isPublic', true)
  health () {
    return { status: 'ok' };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne (@Param('id') id: string, @TenantCredentials() tenant, @Req() req) {
    console.log('Get One product', tenant);
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.productsService.findOne(id, tenant.tenantId, jwtToken);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async update (
  @Param('id') id: string,
    @Body() updateProductDto: UpdateProductDto,
    @TenantCredentials() tenant,
    @Req() req
  ) {
    console.log(tenant);
    const jwtToken = req.headers.authorization?.replace('Bearer ', '') || '';
    return await this.productsService.update(id, tenant.tenantId, updateProductDto, jwtToken);
  }
}
