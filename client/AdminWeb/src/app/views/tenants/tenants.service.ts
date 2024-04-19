/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 */
import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from 'src/environments/environment';
import { map } from 'rxjs/operators';

import { Tenant } from './models/tenant';

@Injectable({
  providedIn: 'root',
})
export class TenantsService {
  constructor(private http: HttpClient) {}
  baseUrl = `${environment.apiUrl}`;
  tenantsApiUrl = `${this.baseUrl}/tenants`;

  fetch(): Observable<Tenant[]> {
    return this.http
      .get<Tenant[]>(this.tenantsApiUrl)
      .pipe(map((response: any) => response.data));
  }

  post(tenant: Tenant): Observable<any> {
    return this.http.post(this.tenantsApiUrl, tenant);
  }

  tenantUrl = (id: any) => {
    return `${this.tenantsApiUrl}/${id}`;
  };

  get(id: string): Observable<Tenant> {
    return this.http
      .get(this.tenantUrl(id))
      .pipe(map((response: any) => response.data));
  }

  delete(tenant: Tenant): Observable<any> {
    return this.http.delete(this.tenantUrl(tenant.tenantId), {
      body: tenant,
    });
  }
}
