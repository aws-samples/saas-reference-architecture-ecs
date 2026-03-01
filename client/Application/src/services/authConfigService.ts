// Auth configuration service for SaaS (shared between ECS and EKS)
// Calls SBT ControlPlane tenant-config API to get tenant auth info
import axios from 'axios';
import { environment } from '../config/environment';

// SBT tenant-config API response structure
interface TenantConfigResponse {
  userPoolId: string;
  appClientId: string;
  apiGatewayUrl: string;
}

export interface TenantAuthConfig {
  tenantId: string;
  appClientId: string;
  authServer: string;     // Cognito OIDC issuer URL (derived from userPoolId)
  userPoolId: string;
  apiGatewayUrl: string;
}

/**
 * Derive Cognito OIDC issuer URL from User Pool ID.
 * e.g. "ap-northeast-2_aIK2UR1nn" -> "https://cognito-idp.ap-northeast-2.amazonaws.com/ap-northeast-2_aIK2UR1nn"
 */
function deriveAuthServer(userPoolId: string): string {
  const region = userPoolId.split('_')[0];
  return `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
}

class AuthConfigurationService {
  async setTenantConfig(tenantName: string): Promise<TenantAuthConfig> {
    try {
      // controlPlaneUrl is the standard field; apiUrl is fallback for legacy buildspec
      const rawUrl = environment.controlPlaneUrl || (environment as any).apiUrl || '';
      const baseUrl = rawUrl.replace(/\/+$/, '');
      const url = `${baseUrl}/tenant-config/${tenantName}`;

      console.log('Calling tenant config API:', url);

      const response = await axios.get<TenantConfigResponse>(url, {
        headers: { 'Accept': 'application/json' },
        timeout: 10000
      });

      const data = typeof response.data === 'string'
        ? JSON.parse(response.data)
        : response.data;

      if (!data?.appClientId || !data?.userPoolId) {
        throw new Error('Invalid tenant config response');
      }

      const authServer = deriveAuthServer(data.userPoolId);

      // Remove trailing slash from apiGatewayUrl if present
      const apiGatewayUrl = (data.apiGatewayUrl || '').replace(/\/$/, '');

      const config: TenantAuthConfig = {
        tenantId: tenantName,
        appClientId: data.appClientId,
        authServer,
        userPoolId: data.userPoolId,
        apiGatewayUrl,
      };

      // Store in sessionStorage
      sessionStorage.setItem('app_tenantName', tenantName);
      sessionStorage.setItem('app_tenantId', config.tenantId);
      sessionStorage.setItem('app_appClientId', config.appClientId);
      sessionStorage.setItem('app_authServer', config.authServer);
      sessionStorage.setItem('app_userPoolId', config.userPoolId);
      sessionStorage.setItem('app_apiGatewayUrl', config.apiGatewayUrl);

      console.log('Tenant config set successfully:', config);
      return config;
    } catch (error) {
      console.error('Error setting tenant config:', error);
      throw error;
    }
  }

  cleanSessionStorage(): void {
    sessionStorage.removeItem('app_tenantName');
    sessionStorage.removeItem('app_tenantId');
    sessionStorage.removeItem('app_appClientId');
    sessionStorage.removeItem('app_authServer');
    sessionStorage.removeItem('app_userPoolId');
    sessionStorage.removeItem('app_apiGatewayUrl');
  }

  getTenantName(): string | null {
    return sessionStorage.getItem('app_tenantName');
  }

  getAppClientId(): string | null {
    return sessionStorage.getItem('app_appClientId');
  }

  getAuthServer(): string | null {
    return sessionStorage.getItem('app_authServer');
  }

  getUserPoolId(): string | null {
    return sessionStorage.getItem('app_userPoolId');
  }

  getTenantId(): string | null {
    return sessionStorage.getItem('app_tenantId');
  }

  getApiGatewayUrl(): string | null {
    return sessionStorage.getItem('app_apiGatewayUrl');
  }
}

export const authConfigService = new AuthConfigurationService();
