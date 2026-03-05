import { httpClient } from './httpClient';
import { environment } from '../config/environment';

export interface FossaApiEndpoint {
  label: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  service: 'fossacore' | 'fossaadmin';
  description: string;
}

export const FOSSACORE_APIS: FossaApiEndpoint[] = [
  { label: 'Health Check', method: 'GET', path: '/health', service: 'fossacore', description: 'fossacore health check' },
  { label: 'Customer List', method: 'POST', path: '/customer/custList', service: 'fossacore', description: 'Customer list' },
  { label: 'Product List', method: 'POST', path: '/product/schProductList', service: 'fossacore', description: 'Product list' },
  { label: 'Billing List', method: 'POST', path: '/billing/schBillingList', service: 'fossacore', description: 'Billing list' },
  { label: 'Rating List', method: 'POST', path: '/rating/schRatingList', service: 'fossacore', description: 'Rating list' },
  { label: 'Support List', method: 'POST', path: '/support/schSupportList', service: 'fossacore', description: 'Support list' },
];

export const FOSSAADMIN_APIS: FossaApiEndpoint[] = [
  { label: 'Health Check', method: 'GET', path: '/health', service: 'fossaadmin', description: 'fossaadmin health check' },
  { label: 'Customer Status', method: 'GET', path: '/customers/customerStatus', service: 'fossaadmin', description: 'Customer status' },
  { label: 'Customer List', method: 'GET', path: '/customers/customerList', service: 'fossaadmin', description: 'Customer list' },
  { label: 'Product List', method: 'GET', path: '/products/productList', service: 'fossaadmin', description: 'Product list' },
  { label: 'Billing List', method: 'GET', path: '/billing/billingList', service: 'fossaadmin', description: 'Billing list' },
  { label: 'Operation List', method: 'GET', path: '/operation/operationList', service: 'fossaadmin', description: 'Operation list' },
];

export async function callFossaApi(endpoint: FossaApiEndpoint): Promise<any> {
  const base = environment.apiUrl.replace(/\/$/, '');
  const url = `${base}/${endpoint.service}${endpoint.path}`;
  if (endpoint.method === 'GET') {
    const res = await httpClient.get(url);
    return res.status === 204 ? '(No Content)' : res.data;
  } else {
    const res = await httpClient.post(url, {});
    return res.status === 204 ? '(No Content)' : res.data;
  }
}
