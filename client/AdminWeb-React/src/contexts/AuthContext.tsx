import React, { createContext, useContext, ReactNode } from 'react';
import { AuthProvider as OidcAuthProvider, useAuth as useOidcAuth } from 'react-oidc-context';
import { User } from 'oidc-client-ts';
import { oidcConfig } from '../auth/AuthConfig';
import { environment } from '../config/environment';

interface AuthContextType {
  user: User | null | undefined;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: any;
  login: () => void;
  logout: () => void;
  getAccessToken: () => string | undefined;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

const AuthProviderInner: React.FC<AuthProviderProps> = ({ children }) => {
  const oidcAuth = useOidcAuth();

  // OIDC 에러 처리 개선
  React.useEffect(() => {
    if (oidcAuth.error) {
      console.error('OIDC Error:', oidcAuth.error);
      
      // 특정 에러 타입에 대한 자동 복구 시도
      if (oidcAuth.error.message?.includes('No matching state found')) {
        console.log('Attempting to clear stale state...');
        oidcAuth.clearStaleState();
      }
    }
  }, [oidcAuth.error]);

  const value: AuthContextType = {
    user: oidcAuth.user,
    isAuthenticated: oidcAuth.isAuthenticated,
    isLoading: oidcAuth.isLoading,
    error: oidcAuth.error,
    login: () => {
      try {
        oidcAuth.signinRedirect();
      } catch (error) {
        console.error('Login redirect failed:', error);
      }
    },
    logout: () => {
      try {
        // Clear storage first
        localStorage.clear();
        sessionStorage.clear();
        
        // Direct Cognito logout URL
        const cognitoDomain = environment.issuer.replace('/oauth2/token', '');
        const clientId = environment.clientId;
        const logoutUrl = `${cognitoDomain}/logout?client_id=${clientId}&logout_uri=${encodeURIComponent(window.location.origin)}`;
        
        window.location.href = logoutUrl;
      } catch (error) {
        console.error('Logout failed:', error);
        localStorage.clear();
        sessionStorage.clear();
        window.location.reload();
      }
    },
    getAccessToken: () => oidcAuth.user?.access_token,
    clearError: () => {
      try {
        oidcAuth.clearStaleState();
      } catch (error) {
        console.error('Clear error failed:', error);
      }
    },
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  return (
    <OidcAuthProvider {...oidcConfig}>
      <AuthProviderInner>
        {children}
      </AuthProviderInner>
    </OidcAuthProvider>
  );
};