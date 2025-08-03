import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo, useCallback } from 'react';
import { Auth, Hub } from 'aws-amplify';
import { authConfigService } from '../services/authConfigService';
import { TENANT_DEFAULTS, createTenantId } from '../constants/tenant';

interface Tenant {
  id: string;
  name: string;
  tier?: string;
}

interface TenantContextType {
  tenant: Tenant | null;
  setTenant: (tenant: Tenant | null) => void;
  loading: boolean;
  setTenantConfig: (tenantName: string) => Promise<string>;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export const useTenant = () => {
  const context = useContext(TenantContext);
  if (context === undefined) {
    throw new Error('useTenant must be used within a TenantProvider');
  }
  return context;
};

interface TenantProviderProps {
  children: ReactNode;
}

export const TenantProvider: React.FC<TenantProviderProps> = ({ children }) => {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  const checkTenant = useCallback(async () => {
    try {
      const tenantName = sessionStorage.getItem('app_tenantName');
      if (tenantName) {
        let tenantTier: string | null = null;
        
        try {
          // Get current user from Amplify Auth
          const user = await Auth.currentAuthenticatedUser();
          console.log('TenantContext - Current user:', user);
          
          if (user && user.attributes && user.attributes['custom:tenantTier']) {
            tenantTier = user.attributes['custom:tenantTier'];
            console.log('TenantContext - Found tier from Cognito:', tenantTier);
          }
        } catch (authError) {
          console.log('Could not get authenticated user:', authError);
        }
        
        console.log('TenantContext - Loading tenant:', tenantName, 'tier:', tenantTier);
        
        // Create tenant object with tier from Cognito
        const storedTenant: Tenant = {
          id: createTenantId(tenantName),
          name: tenantName,
          ...(tenantTier && { tier: tenantTier }),
        };
        setTenant(storedTenant);
      }
    } catch (error) {
      console.error('Failed to load tenant:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial check
    checkTenant();

    // Listen for auth state changes
    const authListener = Hub.listen('auth', (data) => {
      console.log('TenantContext - Auth event:', data.payload.event);
      
      if (data.payload.event === 'signIn') {
        console.log('TenantContext - User signed in, updating tenant info');
        // Small delay to ensure user attributes are available
        setTimeout(() => {
          checkTenant();
        }, 500);
      }
    });

    return () => {
      Hub.remove('auth', authListener);
    };
  }, [checkTenant]);

  const handleSetTenant = useCallback((newTenant: Tenant | null) => {
    setTenant(newTenant);
    if (newTenant) {
      // Store only tenant name in sessionStorage
      sessionStorage.setItem('app_tenantName', newTenant.name);
    } else {
      sessionStorage.removeItem('app_tenantName');
      authConfigService.cleanSessionStorage();
    }
  }, []);

  const setTenantConfig = useCallback(async (tenantName: string): Promise<string> => {
    try {
      const configParams = await authConfigService.setTenantConfig(tenantName);
      
      console.log('TenantContext - Creating new tenant:', tenantName);
      
      const newTenant: Tenant = {
        id: createTenantId(tenantName),
        name: tenantName,
      };
      
      handleSetTenant(newTenant);
      
      // Generate Cognito login URL
      const loginUrl = authConfigService.configureCognitoAuth(configParams);
      return loginUrl;
    } catch (error) {
      throw error;
    }
  }, [handleSetTenant]);

  const value = useMemo(() => ({
    tenant,
    setTenant: handleSetTenant,
    loading,
    setTenantConfig
  }), [tenant, handleSetTenant, loading, setTenantConfig]);

  return (
    <TenantContext.Provider value={value}>
      {children}
    </TenantContext.Provider>
  );
};