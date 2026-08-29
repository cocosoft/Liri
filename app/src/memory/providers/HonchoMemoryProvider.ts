// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * HonchoMemoryProvider — Honcho 外部记忆提供商
 *
 * P1-4: 对标 hermes-agent Honcho Memory Provider。
 * 通过 Honcho REST API (https://honcho.dev) 接入外部记忆。
 *
 * 环境变量：
 *   HONCHO_API_KEY — API 密钥（必需）
 *   HONCHO_BASE_URL — API 地址（默认 https://api.honcho.dev）
 */

import type {
  ExternalMemoryProvider,
  ExternalMemoryEntry,
  MemoryQuery,
} from './ExternalMemoryProvider';
import { configManager } from '@modules/config';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('memory:providers:honcho');

export interface HonchoConfig {
  apiKey: string;
  baseUrl: string;
  /** 请求超时（毫秒），默认 10_000 */
  timeoutMs: number;
  /** 最大重试次数，默认 2 */
  maxRetries: number;
}

const DEFAULT_HONCHO_CONFIG: Partial<HonchoConfig> = {
  baseUrl: 'https://api.honcho.dev',
  timeoutMs: 10_000,
  maxRetries: 2,
};

export class HonchoMemoryProvider implements ExternalMemoryProvider {
  readonly id = 'honcho';
  readonly displayName = 'Honcho';

  private config: HonchoConfig;
  private initialized = false;

  constructor(config?: Partial<HonchoConfig>) {
    const apiKey = config?.apiKey || configManager.env('HONCHO_API_KEY') || '';
    const baseUrl =
      config?.baseUrl ||
      configManager.env('HONCHO_BASE_URL') ||
      DEFAULT_HONCHO_CONFIG.baseUrl!;
    const timeoutMs = config?.timeoutMs ?? DEFAULT_HONCHO_CONFIG.timeoutMs!;
    const maxRetries = config?.maxRetries ?? DEFAULT_HONCHO_CONFIG.maxRetries!;

    this.config = { apiKey, baseUrl, timeoutMs, maxRetries };
  }

  async initialize(): Promise<void> {
    if (!this.config.apiKey) {
      logger.warn('Honcho API key not configured, provider disabled');
      return;
    }
    const ok = await this.healthCheck();
    if (ok) {
      this.initialized = true;
      logger.info('HonchoMemoryProvider initialized', {
        baseUrl: this.config.baseUrl,
      });
    }
  }

  async fetchAllMemories(query?: MemoryQuery): Promise<ExternalMemoryEntry[]> {
    if (!this.initialized) return [];

    const params = new URLSearchParams();
    if (query?.limit) params.set('limit', String(query.limit));
    if (query?.offset) params.set('offset', String(query.offset));
    if (query?.tags?.length) params.set('tags', query.tags.join(','));

    try {
      const data = await this.request<any[]>(
        `/v1/memories?${params.toString()}`,
        { method: 'GET' }
      );

      if (!Array.isArray(data)) return [];

      return data.map((item: Record<string, unknown>) => ({
        id: String(item.id || ''),
        content: String(item.content || ''),
        tags: Array.isArray(item.tags) ? item.tags : [],
        priority: Number(item.priority ?? 0),
        createdAt: Number(item.created_at ?? Date.now()),
        updatedAt: Number(item.updated_at ?? Date.now()),
        metadata: (item.metadata as Record<string, unknown>) || {},
      }));
    } catch (err) {
      logger.warn('Honcho fetchAllMemories failed', {
        error: String(err),
      });
      return [];
    }
  }

  async fetchMemoryById(id: string): Promise<ExternalMemoryEntry | null> {
    if (!this.initialized) return null;

    try {
      const data = await this.request<any>(`/v1/memories/${id}`, {
        method: 'GET',
      });
      if (!data) return null;

      return {
        id: String(data.id || id),
        content: String(data.content || ''),
        tags: Array.isArray(data.tags) ? data.tags : [],
        priority: Number(data.priority ?? 0),
        createdAt: Number(data.created_at ?? Date.now()),
        updatedAt: Number(data.updated_at ?? Date.now()),
        metadata: (data.metadata as Record<string, unknown>) || {},
      };
    } catch (err) {
      // KB-MEM-GET-LOG（2026-08-29）：外部记忆服务请求失败静默返回 null →
      // 记忆读取静默降级为空，与 syncMemories 的 warn 处理不一致
      logger.warn('Honcho getMemory failed', {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async syncMemories(entries: ExternalMemoryEntry[]): Promise<void> {
    if (!this.initialized || entries.length === 0) return;

    try {
      await this.request('/v1/memories/sync', {
        method: 'POST',
        body: JSON.stringify({
          memories: entries.map((e) => ({
            id: e.id,
            content: e.content,
            tags: e.tags,
            priority: e.priority,
            metadata: e.metadata,
          })),
        }),
      });
    } catch (err) {
      logger.warn('Honcho syncMemories failed', {
        error: String(err),
      });
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.config.apiKey) return false;
    try {
      await this.request('/v1/health', { method: 'GET' });
      return true;
    } catch {
      return false;
    }
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    logger.info('HonchoMemoryProvider shutdown');
  }

  private async request<T>(path: string, options: RequestInit): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(
          () => controller.abort(),
          this.config.timeoutMs
        );

        const res = await fetch(url, {
          ...options,
          headers,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          throw new Error(`Honcho HTTP ${res.status}: ${res.statusText}`);
        }

        return (await res.json()) as T;
      } catch (err) {
        lastError = err as Error;
        if (attempt < this.config.maxRetries) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
        }
      }
    }

    throw lastError ?? new Error('Honcho request failed');
  }
}
