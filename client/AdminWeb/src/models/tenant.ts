interface Price {
  id: string;
  metricName: string;
}

interface TenantData {
  tenantName?: string | null;
  email?: string | undefined | null;
  tier?: string | undefined | null;
  prices?: Price[];
  useFederation?: string;
}

export interface TenantRegistrationData {
  tenantRegistrationId?: string;
  registrationStatus?: string;
}

export interface Tenant {
  tenantId?: string;
  tenantData: TenantData;
  tenantRegistrationData: TenantRegistrationData;
}

export interface CreateTenantRequest {
  tenantId: string;
  tenantData: TenantData;
  tenantRegistrationData: TenantRegistrationData;
}