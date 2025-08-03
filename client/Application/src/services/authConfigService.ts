// Angular의 AuthConfigurationService를 React로 변환
import axios from 'axios';
import { environment } from '../config/environment';

interface ConfigParams {
  userPoolId: string;
  appClientId: string;
  apiGatewayUrl: string;
  tier?: string;
}

class AuthConfigurationService {
  private params: ConfigParams | null = null;

  async setTenantConfig(tenantName: string): Promise<ConfigParams> {
    try {
      const apiUrl = environment.apiUrl; // environment.ts에서 직접 가져오기
      const url = `${apiUrl}/tenant-config/${tenantName}`;
      
      console.log('Calling tenant config API:', url);
      
      // 로컬 테스트를 위한 임시 데이터 (실제 배포 시에는 제거)
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        console.log('Using test data for local development');
        this.params = {
          userPoolId: "ap-northeast-2_znj5rT26i",
          appClientId: "6v1015kujbpmp5k0r4r167ud3f", 
          apiGatewayUrl: "https://1ygh9dyq7b.execute-api.ap-northeast-2.amazonaws.com/prod/",
          tier: "ADVANCED"
        };
      } else {
        console.log('Making API request to:', url);
        
        const response = await axios.get<ConfigParams>(url, {
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          },
          timeout: 10000
        });
        
        console.log('Raw API response:', response);
        console.log('Response status:', response.status);
        console.log('Response headers:', response.headers);
        console.log('Response data:', response.data);
        console.log('Response data type:', typeof response.data);
        console.log('Response data stringified:', JSON.stringify(response.data));
        
        // 응답 데이터 검증
        if (!response.data) {
          console.error('Response data is falsy:', response.data);
          throw new Error('No data received from tenant config API');
        }
        
        // 응답이 문자열인 경우 JSON 파싱 시도
        if (typeof response.data === 'string') {
          console.log('Response is string, attempting to parse JSON');
          try {
            this.params = JSON.parse(response.data);
          } catch (parseError) {
            console.error('Failed to parse JSON:', parseError);
            throw new Error('Invalid JSON response from tenant config API');
          }
        } else {
          this.params = response.data;
        }
      }
      
      console.log('Received tenant config:', this.params);

      // 안전한 null/undefined 체크
      if (!this.params) {
        throw new Error('Tenant config params is null');
      }
      
      if (!this.params.apiGatewayUrl) {
        throw new Error('apiGatewayUrl is missing from tenant config');
      }

      // Remove trailing slash if present
      this.params.apiGatewayUrl = this.params.apiGatewayUrl.replace(/\/$/, '');

      // Store in sessionStorage for better security with app prefix
      sessionStorage.setItem('app_userPoolId', this.params.userPoolId);
      sessionStorage.setItem('app_tenantName', tenantName);
      sessionStorage.setItem('app_appClientId', this.params.appClientId);
      sessionStorage.setItem('app_apiGatewayUrl', this.params.apiGatewayUrl);

      console.log('Tenant config set successfully:', this.params);
      return this.params;
    } catch (error) {
      console.error('Error setting tenant config:', error);
      throw error;
    }
  }

  configureCognitoAuth(params: ConfigParams): string {
    try {
      console.log('configureCognitoAuth input params:', params);
      console.log('Original userPoolId:', params.userPoolId);
      
      // User Pool ID 대소문자 강제 수정 (임시 해결책)
      let correctedUserPoolId = params.userPoolId;
      if (params.userPoolId.includes('w469bx8kf')) {
        correctedUserPoolId = params.userPoolId.replace('w469bx8kf', 'W469BX8kF');
        console.log('Corrected userPoolId from lowercase to uppercase:', correctedUserPoolId);
      }
      
      const region = correctedUserPoolId.split('_')[0];
      console.log('Extracted region:', region);
      
      const redirectUri = encodeURIComponent(window.location.origin);
      console.log('Redirect URI:', redirectUri);
      
      // Cognito OAuth2 로그인 URL 생성 (올바른 형식)
      // User Pool ID에서 도메인 프리픽스 추출 (예: ap-northeast-2_W469BX8kF -> W469BX8kF)
      const domainPrefix = correctedUserPoolId.split('_')[1].toLowerCase();
      const loginUrl = `https://${domainPrefix}.auth.${region}.amazoncognito.com/login?` +
        `client_id=${params.appClientId}&` +
        `response_type=code&` +
        `scope=email+openid+profile&` +
        `redirect_uri=${redirectUri}`;

      console.log('Generated login URL components:');
      console.log('- Original userPoolId:', params.userPoolId);
      console.log('- Corrected userPoolId:', correctedUserPoolId);
      console.log('- Full login URL:', loginUrl);
      
      return loginUrl;
    } catch (err) {
      console.error('Unable to configure Cognito auth:', err);
      throw err;
    }
  }

  cleanSessionStorage(): void {
    sessionStorage.removeItem('app_tenantName');
    sessionStorage.removeItem('app_userPoolId');
    sessionStorage.removeItem('app_appClientId');
    sessionStorage.removeItem('app_apiGatewayUrl');
  }

  // 개발 시 Chrome extension 데이터 정리 (선택사항)
  cleanChromeExtensionData(): void {
    if (process.env.NODE_ENV === 'development') {
      Object.keys(sessionStorage).forEach(key => {
        if (key.startsWith('chrome-extension:')) {
          sessionStorage.removeItem(key);
        }
      });
      
      console.log('Chrome extension data cleaned from sessionStorage');
    }
  }

  getTenantName(): string | null {
    return sessionStorage.getItem('app_tenantName');
  }

  getApiGatewayUrl(): string | null {
    return sessionStorage.getItem('app_apiGatewayUrl');
  }

  getUserPoolId(): string | null {
    return sessionStorage.getItem('app_userPoolId');
  }

  getAppClientId(): string | null {
    return sessionStorage.getItem('app_appClientId');
  }
}

export const authConfigService = new AuthConfigurationService();