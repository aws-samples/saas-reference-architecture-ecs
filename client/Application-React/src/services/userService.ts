// User service matching Angular version with JWT token support
import { httpClient } from './httpClient';
import { User, CreateUserRequest } from '../types/User';

class UserService {
  private get baseUrl(): string {
    const apiGatewayUrl = localStorage.getItem('apiGatewayUrl');
    return `${apiGatewayUrl}/users`;
  }

  async fetch(): Promise<User[]> {
    const response = await httpClient.get<User[]>(this.baseUrl);
    return response.data;
  }

  async create(user: CreateUserRequest): Promise<User> {
    const response = await httpClient.post<User>(this.baseUrl, user);
    return response.data;
  }

  // Angular에서는 update 메서드가 비어있으므로 구현하지 않음
  // async update(email: string, user: User): Promise<User> {
  //   // Not implemented in Angular version
  // }
}

export const userService = new UserService();