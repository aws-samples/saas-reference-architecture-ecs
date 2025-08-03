import api from './api';
import { Tenant, TenantRegistrationData, CreateTenantRequest } from '../models/tenant';
import { environment } from '../config/environment';

class TenantService {
  private baseUrl = environment.apiUrl;
  private tenantsApiUrl = `${this.baseUrl}/tenant-registrations`;
  private tenantsMgmtApiUrl = `${this.baseUrl}/tenants`;

  async fetchTenants(): Promise<Tenant[]> {
    try {
      // Angular와 동일하게 /tenants 엔드포인트 사용
      const response = await api.get<{ data: Tenant[] }>(this.tenantsMgmtApiUrl);
      console.log('Raw API response:', response.data); // 디버깅용
      return response.data.data || [];
    } catch (error) {
      console.error('Error fetching tenants:', error);
      throw error;
    }
  }

  async createTenant(tenant: CreateTenantRequest): Promise<any> {
    try {
      const response = await api.post(this.tenantsApiUrl, tenant);
      return response.data;
    } catch (error) {
      console.error('Error creating tenant:', error);
      throw error;
    }
  }

  async getTenant(id: string): Promise<TenantRegistrationData> {
    try {
      const response = await api.get<{ data: TenantRegistrationData }>(`${this.tenantsApiUrl}/${id}`);
      return response.data.data;
    } catch (error) {
      console.error('Error fetching tenant:', error);
      throw error;
    }
  }

  async deleteTenant(tenant: any): Promise<any> {
    try {
      // Handle different tenant object structures
      const tenantId = tenant.tenantRegistrationData?.tenantRegistrationId || 
                      tenant.tenantRegistrationId ||
                      tenant.id ||
                      tenant.tenantId;
      
      if (!tenantId) {
        throw new Error('Tenant ID not found in tenant object');
      }
      
      console.log('Deleting tenant with ID:', tenantId);
      console.log('Full tenant object:', tenant);
      
      const response = await api.delete(`${this.tenantsApiUrl}/${tenantId}`, {
        data: tenant,
      });
      return response.data;
    } catch (error) {
      console.error('Error deleting tenant:', error);
      throw error;
    }
  }
}

export const tenantService = new TenantService();
export default tenantService;