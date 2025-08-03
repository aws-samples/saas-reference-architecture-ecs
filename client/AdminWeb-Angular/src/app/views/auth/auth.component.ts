import { Component, OnInit } from '@angular/core';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { from, Observable, pipe } from 'rxjs';
// import { Auth } from 'aws-amplify';
import { map } from 'rxjs/operators';

@Component({
  templateUrl: './auth.component.html',
  styleUrls: ['./auth.component.scss'],
})
export class AuthComponent implements OnInit {
  session$: Observable<any> | undefined;
  userData$: Observable<any> | undefined;
  isAuthenticated$: Observable<boolean> | undefined;
  checkSessionChanged$: Observable<boolean> | undefined;
  idToken$: Observable<string> | undefined;
  accessToken$: Observable<string> | undefined;
  checkSessionChanged: any;

  constructor(private service: OidcSecurityService) {}

  ngOnInit(): void {
    this.service.getUserData().subscribe((res) => console.log(res));
    this.accessToken$ = this.service.getAccessToken();
    this.idToken$ = this.service.getIdToken();
    this.isAuthenticated$ = this.service.isAuthenticated$.pipe(
      map((res) => res.isAuthenticated),
    );
    this.userData$ = this.service.getUserData();
  }

  async logout() {
    await this.service.logoffLocal();
  }
}
