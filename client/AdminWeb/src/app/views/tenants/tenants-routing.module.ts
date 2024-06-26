/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 */
import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';
import { CreateComponent } from './create/create.component';

import { ListComponent } from './list/list.component';
import { DetailComponent } from './detail/detail.component';

const routes: Routes = [
  {
    path: '',
    redirectTo: 'list',
    pathMatch: 'full',
  },
  {
    path: 'list',
    component: ListComponent,
    data: {
      title: 'Tenant List',
    },
  },
  {
    path: 'create',
    component: CreateComponent,
    data: {
      title: 'Provision new tenant',
    },
  },
  {
    path: 'detail/:tenantId',
    component: DetailComponent,
    data: {
      title: 'Tenant Detail',
    },
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class TenantsRoutingModule {}
