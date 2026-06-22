/**
 * Auth Store — 薄委托层
 *
 * 此文件保持向后兼容的导出接口（useAuthStore, useApiKeyStore），
 * 内部状态和方法已合并到 appStore，此处仅提供基于 useAppStore 的封装。
 *
 * 消费方无需修改 import 路径即可继续使用。
 */

import { useAppStore } from "./appStore";
import type { User, ApiKey } from "../services/authService";

// ============================================================
// useAuthStore — 认证状态委托
// ============================================================

interface AuthSlice {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, email?: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

function authSlice(s: {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  authError: string | null;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, email?: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearAuthError: () => void;
}): AuthSlice {
  return {
    user: s.user,
    token: s.token,
    isAuthenticated: s.isAuthenticated,
    isLoading: s.authLoading,
    error: s.authError,
    login: s.login,
    register: s.register,
    logout: s.logout,
    checkAuth: s.checkAuth,
    clearError: s.clearAuthError,
  };
}

export function useAuthStore(): AuthSlice;
export function useAuthStore<T>(selector: (slice: AuthSlice) => T): T;
export function useAuthStore(selector?: any): any {
  const user = useAppStore((s) => s.user);
  const token = useAppStore((s) => s.token);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const isLoading = useAppStore((s) => s.authLoading);
  const error = useAppStore((s) => s.authError);
  const login = useAppStore((s) => s.login);
  const register = useAppStore((s) => s.register);
  const logout = useAppStore((s) => s.logout);
  const checkAuth = useAppStore((s) => s.checkAuth);
  const clearError = useAppStore((s) => s.clearAuthError);
  const slice = { user, token, isAuthenticated, isLoading, error, login, register, logout, checkAuth, clearError };
  return selector ? selector(slice) : slice;
}

useAuthStore.getState = () => authSlice(useAppStore.getState());

// ============================================================
// useApiKeyStore — API Key 状态委托
// ============================================================

interface ApiKeySlice {
  apiKeys: ApiKey[];
  isLoading: boolean;
  error: string | null;
  loadApiKeys: () => Promise<void>;
  createApiKey: (name: string, permissions: string[], expiresInDays?: number) => Promise<string>;
  deleteApiKey: (id: string) => Promise<void>;
}

function apiKeySlice(s: {
  apiKeys: ApiKey[];
  apiKeyLoading: boolean;
  apiKeyError: string | null;
  loadApiKeys: () => Promise<void>;
  createApiKey: (name: string, permissions: string[], expiresInDays?: number) => Promise<string>;
  deleteApiKey: (id: string) => Promise<void>;
}): ApiKeySlice {
  return {
    apiKeys: s.apiKeys,
    isLoading: s.apiKeyLoading,
    error: s.apiKeyError,
    loadApiKeys: s.loadApiKeys,
    createApiKey: s.createApiKey,
    deleteApiKey: s.deleteApiKey,
  };
}

export function useApiKeyStore(): ApiKeySlice;
export function useApiKeyStore<T>(selector: (slice: ApiKeySlice) => T): T;
export function useApiKeyStore(selector?: any): any {
  const apiKeys = useAppStore((s) => s.apiKeys);
  const isLoading = useAppStore((s) => s.apiKeyLoading);
  const error = useAppStore((s) => s.apiKeyError);
  const loadApiKeys = useAppStore((s) => s.loadApiKeys);
  const createApiKey = useAppStore((s) => s.createApiKey);
  const deleteApiKey = useAppStore((s) => s.deleteApiKey);
  const slice = { apiKeys, isLoading, error, loadApiKeys, createApiKey, deleteApiKey };
  return selector ? selector(slice) : slice;
}

useApiKeyStore.getState = () => apiKeySlice({
  apiKeys: useAppStore.getState().apiKeys,
  apiKeyLoading: useAppStore.getState().apiKeyLoading,
  apiKeyError: useAppStore.getState().apiKeyError,
  loadApiKeys: useAppStore.getState().loadApiKeys,
  createApiKey: useAppStore.getState().createApiKey,
  deleteApiKey: useAppStore.getState().deleteApiKey,
});
