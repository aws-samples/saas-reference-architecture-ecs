import { Component, OnInit } from '@angular/core';
import { TenantsService } from '../tenants.service';
import { Observable, map, of, pipe, switchMap } from 'rxjs';
import { Tenant } from '../models/tenant';
import { ActivatedRoute, Router } from '@angular/router';

@Component({
  selector: 'app-detail',
  templateUrl: './detail.component.html',
})
export class DetailComponent implements OnInit {
  // tenant$: Observable<Tenant | null> = of(null);
  tenant$: Observable<Tenant> = of({
    tenantData: {
      tenantName: '',
      email: '',
      tier: 'basic'
    },
    tenantRegistrationData: {
      tenantRegistrationId: '',
      registrationStatus: 'In progress'
    },
   
  });
  
  constructor(
    private tenantsSvc: TenantsService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.tenant$ = this.route.params.pipe(
      switchMap(() => this.route.queryParams),
      switchMap((queryParams) => {
        return this.tenantsSvc.get(queryParams['tenantRegistrationId']).pipe(
          map(registrationInfo => ({
            tenantId: this.route.snapshot.params['tenantId'],
            tenantRegistrationData: {
              tenantRegistrationId: registrationInfo.tenantRegistrationId,
              registrationStatus: registrationInfo.registrationStatus
            },
            tenantData: {
              tenantName: queryParams['tenantName'],
              email: queryParams['email'],
              tier: queryParams['tier']
            },
          }))
        );
      })

      // map((p) => p['tenantId']),
      // switchMap((tenantId) => this.tenantsSvc.get(tenantId)),
      // map(tenant => ({
      //   ...tenant,
      //   tenantRegistrationId: this.route.snapshot.queryParams['tenantRegistrationId']
      // }))
    );
  }

  delete() {
    this.tenant$
      .pipe(switchMap((t) => this.tenantsSvc.delete(t)))
      .subscribe((_) => this.router.navigate(['tenants']));
  }
}
