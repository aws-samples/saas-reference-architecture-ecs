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
  useEc2?: string;
  useRProxy?: string;
}

export interface TenantRegistrationData {
  tenantRegistrationId?: string;
  registrationStatus?: string;
}

export interface Tenant {
  tenantId?: string;
  tenantData: TenantData;
  tenantRegistrationData: TenantRegistrationData;
  sbtaws_active?: boolean;
}

export interface CreateTenantRequest {
  tenantId: string;
  tenantData: TenantData;
  tenantRegistrationData: TenantRegistrationData;
}