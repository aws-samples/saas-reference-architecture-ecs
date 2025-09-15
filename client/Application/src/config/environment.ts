// Environment configuration for React app
export const environment = {
  production: process.env.REACT_APP_PRODUCTION === 'true',
  clientId: process.env.REACT_APP_CLIENT_ID || '',
  issuer: process.env.REACT_APP_ISSUER || '',
  apiUrl: process.env.REACT_APP_API_URL || '',
  wellKnownEndpointUrl: process.env.REACT_APP_WELL_KNOWN_ENDPOINT_URL || '',
};

// Type definitions for better TypeScript support
export interface Environment {
  production: boolean;
  clientId: string;
  issuer: string;
  apiUrl: string;
  wellKnownEndpointUrl: string;
}

export default environment;