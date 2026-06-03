/**
 * 模型管理 Store（DB 驱动）
 * 管理 Provider 列表、CRUD 操作状态
 */

import { create } from 'zustand';
import { providerService } from '../services/providerService';
import type { ProviderInfo, ProviderFormData } from '../types';

interface ModelAdminState {
  providers: ProviderInfo[];
  isLoading: boolean;
  error: string | null;
  savingId: string | null;

  loadProviders: () => Promise<void>;
  createProvider: (data: ProviderFormData) => Promise<void>;
  updateProvider: (id: string, data: Partial<ProviderFormData>) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  toggleProvider: (id: string) => Promise<void>;
  testConnection: (id: string) => Promise<{ success: boolean; error?: string; latencyMs?: number }>;
  fetchModels: (id: string) => Promise<{ models: Array<{ id: string; ownedBy?: string }> } | { error: string }>;

  clearError: () => void;
}

export const useModelAdminStore = create<ModelAdminState>((set) => ({
  providers: [],
  isLoading: false,
  error: null,
  savingId: null,

  loadProviders: async () => {
    set({ isLoading: true, error: null });
    try {
      const providers = await providerService.list();
      set({ providers, isLoading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '获取 Provider 列表失败', isLoading: false });
    }
  },

  createProvider: async (data) => {
    set({ savingId: 'new', error: null });
    try {
      await providerService.create(data);
      const providers = await providerService.list();
      set({ providers, savingId: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '创建 Provider 失败', savingId: null });
    }
  },

  updateProvider: async (id, data) => {
    set({ savingId: id, error: null });
    try {
      await providerService.update(id, data);
      const providers = await providerService.list();
      set({ providers, savingId: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '更新 Provider 失败', savingId: null });
    }
  },

  deleteProvider: async (id) => {
    set({ savingId: id, error: null });
    try {
      await providerService.remove(id);
      const providers = await providerService.list();
      set({ providers, savingId: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '删除 Provider 失败', savingId: null });
    }
  },

  toggleProvider: async (id) => {
    set({ savingId: id, error: null });
    try {
      await providerService.toggle(id);
      const providers = await providerService.list();
      set({ providers, savingId: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '切换状态失败', savingId: null });
    }
  },

  testConnection: async (id) => {
    set({ error: null });
    try {
      const result = await providerService.test(id);
      const first = result.results?.[0];
      return {
        success: !first?.error,
        error: first?.error,
        latencyMs: first?.latency,
      };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : '连接测试失败' };
    }
  },

  fetchModels: async (id) => {
    return providerService.fetchModels(id);
  },

  clearError: () => set({ error: null }),
}));
