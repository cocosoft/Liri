import { create } from "zustand";
import { authService, type User, type ApiKey } from "../services/authService";

interface AuthStore {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  login: (username: string, password: string) => Promise<void>;
  register: (
    username: string,
    password: string,
    email?: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: authService.getStoredUser(),
  token: authService.getStoredToken(),
  isAuthenticated: authService.isAuthenticated(),
  isLoading: false,
  error: null,

  login: async (username: string, password: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authService.login({ username, password });
      set({
        user: response.user,
        token: response.token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "登录失败",
        isLoading: false,
      });
      throw e;
    }
  },

  register: async (username: string, password: string, email?: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await authService.register({
        username,
        password,
        email,
      });
      set({
        user: response.user,
        token: response.token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "注册失败",
        isLoading: false,
      });
      throw e;
    }
  },

  logout: async () => {
    set({ isLoading: true });
    try {
      await authService.logout();
    } finally {
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },

  checkAuth: async () => {
    if (!authService.isAuthenticated()) {
      set({ isAuthenticated: false, user: null });
      return;
    }
    set({ isLoading: true });
    try {
      const user = await authService.getCurrentUser();
      set({
        user,
        isAuthenticated: !!user,
        isLoading: false,
      });
    } catch {
      set({
        user: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },

  clearError: () => set({ error: null }),
}));

interface ApiKeyStore {
  apiKeys: ApiKey[];
  isLoading: boolean;
  error: string | null;

  loadApiKeys: () => Promise<void>;
  createApiKey: (
    name: string,
    permissions: string[],
    expiresInDays?: number,
  ) => Promise<string>;
  deleteApiKey: (id: string) => Promise<void>;
}

export const useApiKeyStore = create<ApiKeyStore>((set) => ({
  apiKeys: [],
  isLoading: false,
  error: null,

  loadApiKeys: async () => {
    set({ isLoading: true, error: null });
    try {
      const apiKeys = await authService.listApiKeys();
      set({ apiKeys, isLoading: false });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "获取API密钥列表失败",
        isLoading: false,
      });
    }
  },

  createApiKey: async (
    name: string,
    permissions: string[],
    expiresInDays?: number,
  ) => {
    set({ isLoading: true, error: null });
    try {
      const result = await authService.createApiKey(
        name,
        permissions,
        expiresInDays,
      );
      set((state) => ({
        apiKeys: [...state.apiKeys, { ...result, key: undefined } as ApiKey],
        isLoading: false,
      }));
      return result.key;
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "创建API密钥失败",
        isLoading: false,
      });
      throw e;
    }
  },

  deleteApiKey: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      await authService.deleteApiKey(id);
      set((state) => ({
        apiKeys: state.apiKeys.filter((k) => k.id !== id),
        isLoading: false,
      }));
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "删除API密钥失败",
        isLoading: false,
      });
      throw e;
    }
  },
}));
