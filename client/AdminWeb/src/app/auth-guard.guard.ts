import { inject } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  RouterStateSnapshot,
} from '@angular/router';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { catchError, map, of } from 'rxjs';

export const canActivate: CanActivateFn = (
  route: ActivatedRouteSnapshot,
  state: RouterStateSnapshot,
) => {
  const authService = inject(OidcSecurityService);

  return authService.checkAuth().pipe(
    map((res) => {
      if (!res.isAuthenticated) {
        authService.authorize();
      }
      return res.isAuthenticated;
    }),
    catchError(() => {
      authService.authorize();
      return of(false);
    }),
  );
};
