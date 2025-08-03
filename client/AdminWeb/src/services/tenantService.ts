import api from './api';
import { Tenant, TenantRegistrationData, CreateTenantRequest } from '../models/tenant';
import { environment } from '../config/environment';
import { handleApiError } from '../types/errors';

class TenantService {
  private baseUrl = environment.apiUrl;
  private tenantsApiUrl = `${this.baseUrl}/tenant-registrations`;
  private tenantsMgmtApiUrl = `${this.baseUrl}/tenants`;

  async fetchTenants(): Promise<Tenant[]> {
    try {
      const response = await api.get<{ data: Tenant[] }>(this.tenantsMgmtApiUrl);
      return response.data.data || [];
    } catch (error: any) {
      throw new Error(handleApiError(error));
    }
  }

  async createTenant(tenant: CreateTenantRequest): Promise<any> {
    try {
      const response = await api.post(this.tenantsApiUrl, tenant);
      return response.data;
    } catch (error: any) {
      throw new Error(handleApiError(error));
    }
  }

  async getTenant(id: string): Promise<TenantRegistrationData> {
    try {
      const response = await api.get<{ data: TenantRegistrationData }>(`${this.tenantsApiUrl}/${id}`);
      return response.data.data;
    } catch (error: any) {
      throw new Error(handleApiError(error));
    }
  }

  async deleteTenant(tenant: any): Promise<any> {
    try {
      const tenantId = tenant.tenantRegistrationData?.tenantRegistrationId || 
                      tenant.tenantRegistrationId ||
                      tenant.id ||
                      tenant.tenantId;
      
      if (!tenantId) {
        throw new Error('Tenant ID not found in tenant object');
      }
      
      const response = await api.delete(`${this.tenantsApiUrl}/${tenantId}`, {
        data: tenant,
      });
      return response.data;
    } catch (error: any) {
      throw new Error(handleApiError(error));
    }
  }
}

export const tenantService = new TenantService();
export default tenantService;