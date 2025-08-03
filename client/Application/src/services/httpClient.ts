// HTTP client with automatic JWT token injection (like Angular's AuthInterceptor)
import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse } from 'axios';
import { Auth } from 'aws-amplify';

class HttpClient {
  private axiosInstance: AxiosInstance;

  constructor() {
    this.axiosInstance = axios.create();
    this.setupInterceptors();
  }

  private setupInterceptors() {
    // Request interceptor to add JWT token (like Angular's AuthInterceptor)
    this.axiosInstance.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        // Skip token for tenant-config requests (like Angular version)
        if (config.url?.includes('tenant-config')) {
          return config;
        }

        try {
          // Get current session and extract JWT token (like Angular version)
          const session = await Auth.currentSession();
          if (session && session.isValid()) {
            const token = session.getIdToken().getJwtToken();
            
            // Add Authorization header with Bearer token
            config.headers.Authorization = `Bearer ${token}`;
          }
        } catch (error) {
          // Continue without token - let the API return 401 if needed
        }

        return config;
      },
      (error) => {
        return Promise.reject(error);
      }
    );

    // Response interceptor for error handling
    this.axiosInstance.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          // Could redirect to login or refresh token here
        }
        return Promise.reject(error);
      }
    );
  }

  // Expose axios methods with proper typing
  get<T = any>(url: string, config?: InternalAxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.axiosInstance.get<T>(url, config);
  }

  post<T = any>(url: string, data?: any, config?: InternalAxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.axiosInstance.post<T>(url, data, config);
  }

  put<T = any>(url: string, data?: any, config?: InternalAxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.axiosInstance.put<T>(url, data, config);
  }

  delete<T = any>(url: string, config?: InternalAxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.axiosInstance.delete<T>(url, config);
  }

  patch<T = any>(url: string, data?: any, config?: InternalAxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.axiosInstance.patch<T>(url, data, config);
  }
}

// Export singleton instance
export const httpClient = new HttpClient();