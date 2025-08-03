import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authConfigService } from '../services/authConfigService';

interface Tenant {
  id: string;
  name: string;
  tier: 'basic' | 'advanced' | 'premium';
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

  useEffect(() => {
    // Check for tenant from localStorage (like Angular version)
    const checkTenant = async () => {
      try {
        const tenantName = localStorage.getItem('tenantName');
        if (tenantName) {
          // Create tenant object from stored name
          const storedTenant: Tenant = {
            id: tenantName.toLowerCase().replace(/\s+/g, '-'),
            name: tenantName,
            tier: 'basic', // Default tier
          };
          setTenant(storedTenant);
        }
      } catch (error) {
        console.error('Failed to load tenant:', error);
      } finally {
        setLoading(false);
      }
    };

    checkTenant();
  }, []);

  const handleSetTenant = (newTenant: Tenant | null) => {
    setTenant(newTenant);
    if (newTenant) {
      // Store tenant name in localStorage like Angular version
      localStorage.setItem('tenantName', newTenant.name);
      localStorage.setItem('selectedTenant', JSON.stringify(newTenant));
    } else {
      localStorage.removeItem('tenantName');
      localStorage.removeItem('selectedTenant');
      authConfigService.cleanLocalStorage();
    }
  };

  const setTenantConfig = async (tenantName: string): Promise<string> => {
    try {
      const configParams = await authConfigService.setTenantConfig(tenantName);
      
      // Create tenant object after successful config
      const newTenant: Tenant = {
        id: tenantName.toLowerCase().replace(/\s+/g, '-'),
        name: tenantName,
        tier: 'basic',
      };
      
      handleSetTenant(newTenant);
      
      // Generate Cognito login URL
      const loginUrl = authConfigService.configureCognitoAuth(configParams);
      return loginUrl;
    } catch (error) {
      console.error('Failed to set tenant config:', error);
      throw error;
    }
  };

  const value = {
    tenant,
    setTenant: handleSetTenant,
    loading,
    setTenantConfig
  };

  return (
    <TenantContext.Provider value={value}>
      {children}
    </TenantContext.Provider>
  );
};