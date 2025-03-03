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
      registrationStatus: 'In progress'
    },
    tenantRegistrationId: '',
  });
  
  constructor(
    private tenantsSvc: TenantsService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.tenant$ = this.route.params.pipe(
      map((p) => p['tenantId']),
      switchMap((tenantId) => this.tenantsSvc.get(tenantId)),
      map(tenant => ({
        ...tenant,
        tenantRegistrationId: this.route.snapshot.queryParams['tenantRegistrationId']
      }))
    );
  }

  delete() {
    this.tenant$
      .pipe(switchMap((t) => this.tenantsSvc.delete(t)))
      .subscribe((_) => this.router.navigate(['tenants']));
  }
}
