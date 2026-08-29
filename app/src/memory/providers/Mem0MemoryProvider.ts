// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Mem0MemoryProvider — Mem0 外部记忆提供商
 *
 * P1-4: 对标 hermes-agent Mem0 Memory Provider。
 * 通过 Mem0 REST API (https://api.mem0.ai) 接入外部记忆。
 *
 * 环境变量：
 *   MEM0_API_KEY — API 密钥（必需）
 *   MEM0_BASE_URL — API 地址（默认 https://api.mem0.ai）
 */

import type {
  ExternalMemoryProvider,
  ExternalMemoryEntry,
  MemoryQuery,
} from './ExternalMemoryProvider';
import { configManager } from '@modules/config';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('memory:providers:mem0');

export interface Mem0Config {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
}

const DEFAULT_MEM0_CONFIG: Partial<Mem0Config> = {
  baseUrl: 'https://api.mem0.ai',
  timeoutMs: 10_000,
  maxRetries: 2,
};

export class Mem0MemoryProvider implements ExternalMemoryProvider {
  readonly id = 'mem0';
  readonly displayName = 'Mem0';

  private config: Mem0Config;
  private initialized = false;

  constructor(config?: Partial<Mem0Config>) {
    const apiKey = config?.apiKey || configManager.env('MEM0_API_KEY') || '';
    const baseUrl =
      config?.baseUrl ||
      configManager.env('MEM0_BASE_URL') ||
      DEFAULT_MEM0_CONFIG.baseUrl!;
    const timeoutMs = config?.timeoutMs ?? DEFAULT_MEM0_CONFIG.timeoutMs!;
    const maxRetries = config?.maxRetries ?? DEFAULT_MEM0_CONFIG.maxRetries!;

    this.config = { apiKey, baseUrl, timeoutMs, maxRetries };
  }

  async initialize(): Promise<void> {
    if (!this.config.apiKey) {
      logger.warn('Mem0 API key not configured, provider disabled');
      return;
    }
    const ok = await this.healthCheck();
    if (ok) {
      this.initialized = true;
      logger.info('Mem0MemoryProvider initialized', {
        baseUrl: this.config.baseUrl,
      });
    }
  }

  async fetchAllMemories(query?: MemoryQuery): Promise<ExternalMemoryEntry[]> {
    if (!this.initialized) return [];

    // Mem0 uses search endpoint for retrieval
    const body: Record<string, unknown> = {
      limit: query?.limit ?? 20,
    };
    if (query?.keywords?.length) {
      body.query = query.keywords.join(' ');
    }
    if (query?.tags?.length) {
      body.filters = { tags: query.tags };
    }

    try {
      const data = await this.request<any>('/v1/memories/search', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      const results = Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data)
          ? data
          : [];

      return results.map((item: Record<string, unknown>) => ({
        id: String(item.id || ''),
        content: String(item.memory || item.content || ''),
        tags: Array.isArray(item.tags) ? item.tags : [],
        priority: Number(item.priority ?? 0),
        createdAt: this.parseTimestamp(item.created_at || item.createdAt),
        updatedAt: this.parseTimestamp(item.updated_at || item.updatedAt),
        metadata: (item.metadata as Record<string, unknown>) || {},
      }));
    } catch (err) {
      logger.warn('Mem0 fetchAllMemories failed', {
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
        content: String(data.memory || data.content || ''),
        tags: Array.isArray(data.tags) ? data.tags : [],
        priority: Number(data.priority ?? 0),
        createdAt: this.parseTimestamp(data.created_at || data.createdAt),
        updatedAt: this.parseTimestamp(data.updated_at || data.updatedAt),
        metadata: (data.metadata as Record<string, unknown>) || {},
      };
    } catch (err) {
      // KB-MEM-GET-LOG（2026-08-29）：外部记忆服务请求失败静默返回 null →
      // 记忆读取静默降级为空，与 syncMemories 的 warn 处理不一致
      logger.warn('Mem0 getMemory failed', {
        id,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async syncMemories(entries: ExternalMemoryEntry[]): Promise<void> {
    if (!this.initialized || entries.length === 0) return;

    // Mem0 sync is done per-memory via add endpoint
    for (const entry of entries) {
      try {
        await this.request('/v1/memories/', {
          method: 'POST',
          body: JSON.stringify({
            messages: [
              {
                role: 'user',
                content: entry.content,
              },
            ],
            metadata: entry.metadata,
          }),
        });
      } catch (err) {
        logger.warn('Mem0 syncMemory failed', {
          id: entry.id,
          error: String(err),
        });
      }
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
    logger.info('Mem0MemoryProvider shutdown');
  }

  private parseTimestamp(val: unknown): number {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const d = new Date(val).getTime();
      return isNaN(d) ? Date.now() : d;
    }
    return Date.now();
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
          throw new Error(`Mem0 HTTP ${res.status}: ${res.statusText}`);
        }

        return (await res.json()) as T;
      } catch (err) {
        lastError = err as Error;
        if (attempt < this.config.maxRetries) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
        }
      }
    }

    throw lastError ?? new Error('Mem0 request failed');
  }
}
