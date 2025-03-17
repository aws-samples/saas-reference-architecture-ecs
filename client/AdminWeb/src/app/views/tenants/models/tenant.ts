// export interface Tenant {
//   tenantId?: string;
//   tenantName?: string | null;
//   email?: string | undefined | null;
//   tier?: string | undefined | null;
//   tenantStatus?: string;
//   isActive?: boolean;
//   [key: string]: any;
// }

interface Price {
  id: string;
  metricName: string;
}

interface TenantData {
  tenantName?: string | null;
  email?: string | undefined | null;
  tier?: string | undefined | null;
  prices?: Price[];
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