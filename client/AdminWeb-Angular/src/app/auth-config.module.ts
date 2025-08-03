import { NgModule } from '@angular/core';
import { AuthModule, LogLevel } from 'angular-auth-oidc-client';
import { environment } from 'src/environments/environment';

@NgModule({
  imports: [
    AuthModule.forRoot({
      config: {
        authority: environment.issuer,
        authWellknownEndpointUrl: environment.wellKnownEndpointUrl,
        clientId: environment.clientId,
        logLevel: LogLevel.Debug,
        postLogoutRedirectUri: window.location.origin,
        redirectUrl: window.location.origin,
        responseType: 'code',
        scope: 'openid profile email tenant/tenant_read tenant/tenant_write user/user_read user/user_write',
      },
    }),
  ],
  exports: [AuthModule],
})
export class AuthConfigModule {}
