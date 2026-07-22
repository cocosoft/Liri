import { httpLegacy as http } from "./httpClient";
import { handleClientError } from "../utils/handleError";

export interface User {
  id: string;
  username: string;
  email?: string;
  role: "admin" | "user" | "guest";
  trustLevel: 1 | 2 | 3 | 4 | 5;
  created_at: number;
  last_login_at?: number;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  email?: string;
}

export interface AuthResponse {
  token: string;
  user: User;
  expires_at: number;
}

export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: number;
  last_used_at?: number;
  expires_at?: number;
  permissions: string[];
}

export interface Permission {
  scope: string;
  description: string;
  level: "none" | "read" | "write" | "admin";
}

const AUTH_TOKEN_KEY = "auth_token";
const AUTH_USER_KEY = "auth_user";

function getStoredToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function setStoredToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

function removeStoredToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

function getStoredUser(): User | null {
  const userStr = localStorage.getItem(AUTH_USER_KEY);
  if (!userStr) return null;
  try {
    return JSON.parse(userStr);
  } catch (e) {
    handleClientError(e, { module: "services:auth", action: "getStoredUser" });
    return null;
  }
}

function setStoredUser(user: User): void {
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}

function removeStoredUser(): void {
  localStorage.removeItem(AUTH_USER_KEY);
}

export const authService = {
  getStoredToken,

  getStoredUser,

  isAuthenticated(): boolean {
    return !!getStoredToken();
  },

  async login(credentials: LoginRequest): Promise<AuthResponse> {
    const response = await http.post<AuthResponse>(
      "/v1/auth/login",
      credentials,
    );
    setStoredToken(response.token);
    setStoredUser(response.user);
    return response;
  },

  async register(data: RegisterRequest): Promise<AuthResponse> {
    const response = await http.post<AuthResponse>("/v1/auth/register", data);
    setStoredToken(response.token);
    setStoredUser(response.user);
    return response;
  },

  async logout(): Promise<void> {
    try {
      await http.post("/v1/auth/logout");
    } catch (e) {
      handleClientError(e, { module: "services:auth", action: "logout" });
    } finally {
      removeStoredToken();
      removeStoredUser();
    }
  },

  async getCurrentUser(): Promise<User | null> {
    const token = getStoredToken();
    if (!token) return null;
    try {
      const user = await http.get<User>("/v1/auth/me");
      setStoredUser(user);
      return user;
    } catch (e) {
      handleClientError(e, { module: "services:auth", action: "getCurrentUser" });
      removeStoredToken();
      removeStoredUser();
      return null;
    }
  },

  async listApiKeys(): Promise<ApiKey[]> {
    return http.get<ApiKey[]>("/v1/apikeys");
  },

  async createApiKey(
    name: string,
    permissions: string[],
    expiresInDays?: number,
  ): Promise<ApiKey & { key: string }> {
    return http.post<ApiKey & { key: string }>("/v1/apikeys", {
      name,
      permissions,
      expires_in_days: expiresInDays,
    });
  },

  async deleteApiKey(id: string): Promise<void> {
    return http.delete(`/v1/apikeys/${id}`);
  },

  async getPermissions(): Promise<Permission[]> {
    return http.get<Permission[]>("/v1/auth/permissions");
  },

  clearAuth(): void {
    removeStoredToken();
    removeStoredUser();
  },
};
