// Cognito OAuth2 authentication processing service
import axios from 'axios';
import { authConfigService } from './authConfigService';

interface CognitoTokenResponse {
  access_token: string;
  id_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
}

interface CognitoUserInfo {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  preferred_username?: string;
  'cognito:username': string;
  'custom:tenantId'?: string;
  'custom:userRole'?: string;
  'custom:company-name'?: string;
}

class CognitoAuthService {
  // Check authentication code from URL
  checkAuthCode(): string | null {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('code');
  }

  // Check error from URL
  checkAuthError(): string | null {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('error');
  }

  // Exchange authentication code for tokens
  async exchangeCodeForTokens(code: string): Promise<CognitoTokenResponse> {
    try {
      const userPoolId = authConfigService.getUserPoolId();
      const appClientId = authConfigService.getAppClientId();
      
      if (!userPoolId || !appClientId) {
        throw new Error('Cognito configuration not found');
      }

      const region = userPoolId.split('_')[0];
      const tokenEndpoint = `https://${userPoolId}.auth.${region}.amazoncognito.com/oauth2/token`;
      
      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: appClientId,
        code: code,
        redirect_uri: window.location.origin,
      });

      const response = await axios.post<CognitoTokenResponse>(
        tokenEndpoint,
        params,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error exchanging code for tokens:', error);
      throw error;
    }
  }

  // Get user info with token
  async getUserInfo(accessToken: string): Promise<CognitoUserInfo> {
    try {
      const userPoolId = authConfigService.getUserPoolId();
      
      if (!userPoolId) {
        throw new Error('User Pool ID not found');
      }

      const region = userPoolId.split('_')[0];
      const userInfoEndpoint = `https://${userPoolId}.auth.${region}.amazoncognito.com/oauth2/userInfo`;

      const response = await axios.get<CognitoUserInfo>(
        userInfoEndpoint,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );

      return response.data;
    } catch (error) {
      console.error('Error getting user info:', error);
      throw error;
    }
  }

  // Store tokens in localStorage
  storeTokens(tokens: CognitoTokenResponse): void {
    sessionStorage.setItem('app_access_token', tokens.access_token);
    sessionStorage.setItem('app_id_token', tokens.id_token);
    sessionStorage.setItem('app_refresh_token', tokens.refresh_token);
    sessionStorage.setItem('app_token_expires_at', (Date.now() + tokens.expires_in * 1000).toString());
  }

  // Get tokens from sessionStorage
  getStoredTokens(): { accessToken: string | null; idToken: string | null; refreshToken: string | null } {
    return {
      accessToken: sessionStorage.getItem('app_access_token'),
      idToken: sessionStorage.getItem('app_id_token'),
      refreshToken: sessionStorage.getItem('app_refresh_token'),
    };
  }

  // Check if token is valid
  isTokenValid(): boolean {
    const expiresAt = sessionStorage.getItem('app_token_expires_at');
    if (!expiresAt) return false;
    
    return Date.now() < parseInt(expiresAt);
  }

  // Clear tokens
  clearTokens(): void {
    sessionStorage.removeItem('app_access_token');
    sessionStorage.removeItem('app_id_token');
    sessionStorage.removeItem('app_refresh_token');
    sessionStorage.removeItem('app_token_expires_at');
  }

  // Generate logout URL
  getLogoutUrl(): string {
    const userPoolId = authConfigService.getUserPoolId();
    const appClientId = authConfigService.getAppClientId();
    
    if (!userPoolId || !appClientId) {
      return window.location.origin;
    }

    const region = userPoolId.split('_')[0];
    const logoutUri = encodeURIComponent(window.location.origin);
    
    return `https://${userPoolId}.auth.${region}.amazoncognito.com/logout?` +
      `client_id=${appClientId}&` +
      `logout_uri=${logoutUri}`;
  }
}

export const cognitoAuthService = new CognitoAuthService();