/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 */
import { Injectable } from '@angular/core';
import {
  HttpRequest,
  HttpHandler,
  HttpEvent,
  HttpInterceptor,
} from '@angular/common/http';
import { Observable } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { environment } from 'src/environments/environment';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  constructor(public service: OidcSecurityService) {}

  intercept(
    req: HttpRequest<any>,
    next: HttpHandler,
  ): Observable<HttpEvent<any>> {
    if (
      req.url.startsWith(environment.issuer) ||
      req.url.includes('auth-info')
    ) {
      return next.handle(req);
    }

    return this.service.getIdToken().pipe(
      switchMap((tok) => {
        req = req.clone({
          headers: req.headers.set('Authorization', 'Bearer ' + tok),
        });
        return next.handle(req);
      }),
    );
  }
}
