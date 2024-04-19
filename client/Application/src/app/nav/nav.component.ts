import { Component, OnInit } from '@angular/core';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { from, Observable, of } from 'rxjs';
import { filter, map, shareReplay } from 'rxjs/operators';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
} from '@angular/router';

import { AuthenticatorService } from '@aws-amplify/ui-angular';
import { Auth, Hub } from 'aws-amplify';
import { navItems } from '../_nav';
import { AuthConfigurationService } from '../views/auth/auth-configuration.service';

@Component({
  selector: 'app-nav',
  templateUrl: './nav.component.html',
  styleUrls: ['./nav.component.scss'],
})
export class NavComponent implements OnInit {
  loading$: Observable<boolean> = of(false);
  isAuthenticated$: Observable<Boolean> | undefined;
  isTenantAdmin$: boolean;
  username$: Observable<string> | undefined;
  companyName$: Observable<string> | undefined;
  userRole$: Observable<string>;
  public navItems = navItems;
  isHandset$: Observable<boolean> = this.breakpointObserver
    .observe(Breakpoints.Handset)
    .pipe(
      map((result) => result.matches),
      shareReplay(),
    );

  constructor(
    private breakpointObserver: BreakpointObserver,
    private router: Router,
    private authConfigService: AuthConfigurationService,
  ) {
    // this.configSvc.loadConfigurations().subscribe((val) => console.log(val));
    this.loading$ = this.router.events.pipe(
      filter(
        (e) =>
          e instanceof NavigationStart ||
          e instanceof NavigationEnd ||
          e instanceof NavigationCancel ||
          e instanceof NavigationError,
      ),
      map((e) => e instanceof NavigationStart),
    );
  }

  ngOnInit(): void {
    try {
      const s = Auth.currentSession().catch((err) => {
        console.log('Failed to get current session. Err: ', err);
        return err;
      });
      const session$ = from(s);
      this.isAuthenticated$ = session$.pipe(
        filter((sesh) => !!sesh),
        map(
          (sesh) =>
            sesh && typeof sesh.isValid === 'function' && sesh.isValid(),
        ),
      );

      const token$ = session$.pipe(
        map(
          (sesh) =>
            sesh && typeof sesh.getIdToken === 'function' && sesh.getIdToken(),
        ),
      );
      this.username$ = token$.pipe(
        map((t) => t && t.payload && t.payload['cognito:username']),
      );
      this.companyName$ = token$.pipe(
        map((t) => t.payload && t.payload['custom:company-name']),
      );
      this.userRole$ = token$.pipe(
        map((t) => t.payload && t.payload['custom:userRole']),
      );

      this.userRole$.subscribe(
        (reusult) => {
          if (reusult === 'TenantAdmin') {
            this.isTenantAdmin$ = true;
            console.log('isTenantAdmin =>', this.isTenantAdmin$);
          }
        },
        (error) => {
          console.log(error);
        },
      );

      Hub.listen('auth', ({ payload: { event, data } }) => {
        if (event === 'signIn') {
          console.log('View loader');
          const { signInUserSession = {} } = data;
          const { idToken = {} } = signInUserSession;
          const { jwtToken, payload = {} } = idToken;
          const {
            'cognito:groups': roles,
            'custom:tenantId': tenantId,
            exp,
            'custom:userRole': userRole,
          } = payload;
          // localStorage.setItem('idToken', jwtToken);
          const payloadToSave = {
            Role: roles[0],
            TenantId: tenantId,
            exp,
            UserRole: userRole,
          };
          if (userRole === 'TenantAdmin') {
            this.isTenantAdmin$ = true;
            console.log('isTenantAdmin', this.isTenantAdmin$);
          }
          // localStorage.setItem('payload', JSON.stringify(payloadToSave));
          this.router.navigate(['/dashboard']);
        } else {
          console.log('Hide loader');
        }
      });
    } catch (err) {
      console.error('Unable to get current session.');
    }
  }

  async logout() {
    await Auth.signOut({ global: true })
      .then((e) => {
        this.authConfigService.cleanLocalStorage();
        this.router.navigate(['/unauthorized']);
      })
      .catch((err) => {
        console.error('Error logging out: ', err);
      });
  }
}
