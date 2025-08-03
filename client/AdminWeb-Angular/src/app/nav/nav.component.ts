import { Component, OnInit } from '@angular/core';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Observable, of } from 'rxjs';
import { filter, map, shareReplay } from 'rxjs/operators';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
} from '@angular/router';

import { navItems } from '../_nav';
import {
  AuthenticatedResult,
  OidcSecurityService,
} from 'angular-auth-oidc-client';

@Component({
  selector: 'app-nav',
  templateUrl: './nav.component.html',
  styleUrls: ['./nav.component.css'],
})
export class NavComponent implements OnInit {
  tenantName = '';
  loading$: Observable<boolean> = of(false);
  isAuthenticated$: Observable<AuthenticatedResult> | undefined;
  username$: Observable<string> | undefined;
  companyName$: Observable<string> | undefined;
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
    public oidcSecurityService: OidcSecurityService,
  ) {
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
    this.isAuthenticated$ = this.oidcSecurityService.isAuthenticated$;
  }

  async login() {
    this.oidcSecurityService.authorize();
  }

  async logout() {
    // TODO This isn't working
    this.oidcSecurityService.logoffAndRevokeTokens().subscribe();
  }
}
