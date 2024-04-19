export interface Tenant {
  tenantId?: string;
  tenantName?: string | null;
  email?: string | undefined | null;
  tier?: string | undefined | null;
  tenantStatus?: string;
  isActive?: boolean;
  [key: string]: any;
}
