import { useState, useCallback } from 'react';
import { Tenant } from '../models/tenant';
import tenantService from '../services/tenantService';
import { handleApiError } from '../types/errors';

export const useTenants = () => {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTenants = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const fetchedTenants = await tenantService.fetchTenants();
      setTenants(fetchedTenants);
    } catch (error: any) {
      setError(handleApiError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteTenant = useCallback(async (tenant: Tenant) => {
    try {
      await tenantService.deleteTenant(tenant);
      setTenants(prev => prev.filter(t => t.tenantId !== tenant.tenantId));
    } catch (error: any) {
      setError(handleApiError(error));
      throw error;
    }
  }, []);

  return {
    tenants,
    loading,
    error,
    loadTenants,
    deleteTenant
  };
};