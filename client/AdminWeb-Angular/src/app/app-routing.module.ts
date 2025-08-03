import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { NavComponent } from './nav/nav.component';
import { AuthComponent } from './views/auth/auth.component';
import { canActivate } from './auth-guard.guard';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'tenants',
    pathMatch: 'full',
  },
  {
    path: '',
    component: NavComponent,
    data: {
      title: 'Home',
    },
    canActivate: [canActivate],
    children: [
      {
        path: 'auth/info',
        component: AuthComponent,
      },
      {
        path: 'dashboard',
        loadChildren: () =>
          import('./views/dashboard/dashboard.module').then(
            (m) => m.DashboardModule,
          ),
      },
      {
        path: 'tenants',
        loadChildren: () =>
          import('./views/tenants/tenants.module').then((m) => m.TenantsModule),
      },
    ],
  },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule],
})
export class AppRoutingModule {}
