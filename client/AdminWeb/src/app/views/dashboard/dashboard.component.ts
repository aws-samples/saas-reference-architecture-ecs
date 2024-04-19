/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 */
import { Component, OnInit } from '@angular/core';
import { TenantsService } from '../tenants/tenants.service';

@Component({
  templateUrl: 'dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  selector: 'app-dashboard',
})
export class DashboardComponent implements OnInit {
  constructor(private tenantSvc: TenantsService) {}

  ngOnInit(): void {}
}
