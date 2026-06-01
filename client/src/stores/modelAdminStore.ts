/**
 * 模型管理 Store
 * 管理 Provider 列表、CRUD 操作状态
 */

import { create } from 'zustand';
import { modelAdminService } from '../services/modelAdminService';
import type { ProviderInfo, ProviderFormData, ChangePreview } from '../types';

interface ModelAdminState {
  providers: ProviderInfo[];
  isLoading: boolean;
  error: string | null;
  savingId: string | null;
  testingId: string | null;
  syncing: boolean;
  lastSyncTime: string | null;

  loadProviders: () => Promise<void>;
  saveProvider: (id: string, data: ProviderFormData) => Promise<void>;
  deleteProvider: (id: string) => Promise<void>;
  setDefaultModel: (providerId: string, modelId: string) => Promise<void>;
  testConnection: (providerId: string, modelId: string) => Promise<{ success: boolean; error?: string }>;
  syncPricing: () => Promise<void>;
  reloadConfig: () => Promise<void>;

  generatePreview: (id: string, data: ProviderFormData, existing: ProviderInfo | undefined) => ChangePreview | null;

  clearError: () => void;
}

const API_PRESETS = [
  { label: 'OpenAI Completions', value: 'openai-completions' },
  { label: 'OpenAI Responses', value: 'openai-responses' },
  { label: 'Anthropic Messages', value: 'anthropic-messages' },
  { label: 'Google Generative AI', value: 'google-generative-ai' },
];

const QUICK_PRESETS: Array<{ name: string; providerId: string; api: string; baseUrl: string; models: string[] }> = [
  { name: 'OpenAI', providerId: 'openai', api: 'openai-completions', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini'] },
  { name: 'DeepSeek', providerId: 'deepseek', api: 'openai-completions', baseUrl: 'https://api.deepseek.com', models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-pro', 'deepseek-v4-flash'] },
  { name: 'Google Gemini', providerId: 'google', api: 'google-generative-ai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', models: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
  { name: 'Ollama (Local)', providerId: 'ollama', api: 'openai-completions', baseUrl: 'http://localhost:11434/v1', models: ['qwen3:1.8b'] },
  { name: '阿里千问', providerId: 'qwen', api: 'openai-completions', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen2.5-coder'] },
];

export { API_PRESETS, QUICK_PRESETS };

export const useModelAdminStore = create<ModelAdminState>((set) => ({
  providers: [],
  isLoading: false,
  error: null,
  savingId: null,
  testingId: null,
  syncing: false,
  lastSyncTime: null,

  loadProviders: async () => {
    set({ isLoading: true, error: null });
    try {
      const providers = await modelAdminService.getProviders();
      set({ providers, isLoading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '获取 Provider 列表失败', isLoading: false });
    }
  },

  saveProvider: async (id, data) => {
    set({ savingId: id, error: null });
    try {
      await modelAdminService.saveProvider(id, data);
      set({ savingId: null });
      const providers = await modelAdminService.getProviders();
      set({ providers });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '保存 Provider 失败', savingId: null });
    }
  },

  deleteProvider: async (id) => {
    set({ savingId: id, error: null });
    try {
      await modelAdminService.deleteProvider(id);
      set({ savingId: null });
      const providers = await modelAdminService.getProviders();
      set({ providers });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '删除 Provider 失败', savingId: null });
    }
  },

  setDefaultModel: async (providerId, modelId) => {
    set({ error: null });
    try {
      await modelAdminService.setDefaultModel(providerId, modelId);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '设置默认模型失败' });
    }
  },

  testConnection: async (providerId, modelId) => {
    set({ testingId: providerId, error: null });
    try {
      const result = await modelAdminService.testConnection(providerId, modelId);
      set({ testingId: null });
      return result;
    } catch (e) {
      set({ testingId: null, error: e instanceof Error ? e.message : '连接测试失败' });
      return { success: false, error: e instanceof Error ? e.message : '连接测试失败' };
    }
  },

  syncPricing: async () => {
    set({ syncing: true, error: null });
    try {
      await modelAdminService.syncPricing();
      set({ syncing: false, lastSyncTime: new Date().toLocaleString() });
    } catch (e) {
      set({ syncing: false, error: e instanceof Error ? e.message : '定价同步失败' });
    }
  },

  reloadConfig: async () => {
    set({ error: null });
    try {
      await modelAdminService.reloadConfig();
      const providers = await modelAdminService.getProviders();
      set({ providers, lastSyncTime: new Date().toLocaleString() });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '配置重载失败' });
    }
  },

  generatePreview: (id, data, existing): ChangePreview | null => {
    const nextModelIds = data.models
      .split(/\n|,|;/g)
      .map((m) => m.trim())
      .filter(Boolean);

    if (!existing) {
      return {
        providerId: id,
        hasChanges: true,
        warnings: [],
        inferredPrimary: nextModelIds[0] ? `${id}/${nextModelIds[0]}` : null,
      };
    }

    const hasApiChange = data.api !== existing.api;
    const hasBaseUrlChange = data.baseUrl.trim() !== existing.baseUrl;
    const currentModels = existing.modelIds;
    const added = nextModelIds.filter((m) => !currentModels.includes(m));
    const removed = currentModels.filter((m) => !nextModelIds.includes(m));
    const hasModelsChange = added.length > 0 || removed.length > 0;

    const warnings: string[] = [];
    if (removed.length > 0) warnings.push(`将移除 ${removed.length} 个模型`);
    if (data.apiKey && data.apiKey.trim()) warnings.push('将更新 API Key');

    const hasInputPrice = data.inputPrice && data.inputPrice.trim();
    const hasOutputPrice = data.outputPrice && data.outputPrice.trim();
    const hasPricingChange = !!(hasInputPrice || hasOutputPrice);

    return {
      providerId: id,
      hasChanges: hasApiChange || hasBaseUrlChange || hasModelsChange || !!data.apiKey.trim() || hasPricingChange,
      warnings,
      apiDiff: { before: existing.api, after: data.api, changed: hasApiChange },
      baseUrlDiff: { before: existing.baseUrl, after: data.baseUrl.trim(), changed: hasBaseUrlChange },
      modelDiff: {
        changed: hasModelsChange,
        beforeCount: currentModels.length,
        afterCount: nextModelIds.length,
        added,
        removed,
      },
      inferredPrimary: nextModelIds[0] ? `${id}/${nextModelIds[0]}` : null,
      pricingDiff: hasPricingChange ? {
        changed: true,
        inputPrice: hasInputPrice ? data.inputPrice : undefined,
        outputPrice: hasOutputPrice ? data.outputPrice : undefined,
      } : undefined,
    };
  },

  clearError: () => set({ error: null }),
}));
