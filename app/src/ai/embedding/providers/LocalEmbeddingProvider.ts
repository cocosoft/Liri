// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 本地嵌入提供者 — LocalEmbeddingProvider
 *
 * 支持两种后端:
 *   - Ollama (本地): 默认 http://localhost:11434, 模型 nomic-embed-text
 *   - OpenAI-compat: 兼容 OpenAI embedding API 的服务
 *
 * 注入到 EmbeddingManager，作为统一嵌入入口的一部分。
 */

import {
  EmbeddingBase,
  EmbeddingOptions,
  EmbeddingResult,
} from '../EmbeddingBase';
import { configManager } from '@modules/config';
import { handleError } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('ai:embedding:providers:LocalEmbeddingProvider');

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_EMBED_MODEL = 'nomic-embed-text';
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_BATCH_SIZE = 10;

/** 本地嵌入后端类型 */
export type LocalEmbeddingBackend = 'ollama' | 'openai-compat';

/** 本地嵌入提供者配置 */
export interface LocalEmbeddingConfig {
  /** 后端类型 */
  provider?: LocalEmbeddingBackend;
  /** Ollama base URL */
  baseUrl?: string;
  /** 模型名称 */
  model?: string;
  /** OpenAI-compat API Key */
  apiKey?: string;
  /** 超时毫秒 */
  timeoutMs?: number;
  /** 批处理大小（仅 openai-compat） */
  batchSize?: number;
  /** 额外请求体（仅 openai-compat） */
  extraBody?: Record<string, unknown>;
}

/**
 * 本地嵌入提供者
 *
 * 默认使用 Ollama 后端，可通过 config.provider 切换为 openai-compat。
 */
export class LocalEmbeddingProvider extends EmbeddingBase {
  readonly modelName: string;

  readonly dimensions: number;

  private config: Required<LocalEmbeddingConfig>;

  constructor(config: LocalEmbeddingConfig = {}) {
    super();
    this.modelName = config.model || DEFAULT_EMBED_MODEL;
    this.dimensions = 768;
    this.config = {
      provider: config.provider || 'ollama',
      baseUrl:
        config.baseUrl || configManager.env('OLLAMA_URL') || DEFAULT_OLLAMA_URL,
      model: config.model || DEFAULT_EMBED_MODEL,
      apiKey: config.apiKey || '',
      timeoutMs: config.timeoutMs || DEFAULT_TIMEOUT_MS,
      batchSize: config.batchSize || DEFAULT_BATCH_SIZE,
      extraBody: config.extraBody || {},
    };
  }

  /**
   * 批量嵌入
   */
  async embed(
    texts: string[],
    options?: EmbeddingOptions
  ): Promise<EmbeddingResult> {
    if (this.config.provider === 'openai-compat') {
      return this.embedOpenAICompat(texts);
    }
    return this.embedOllama(texts);
  }

  /**
   * 探测服务可用性
   */
  override async isAvailable(): Promise<boolean> {
    if (this.config.provider === 'openai-compat') {
      return !!this.config.apiKey;
    }
    const result = await this.probeOllama();
    return result.ok;
  }

  /**
   * 探测 Ollama 服务
   */
  async probeOllama(): Promise<{
    ok: boolean;
    models: string[];
    error?: string;
  }> {
    try {
      const res = await fetch(`${this.config.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok)
        return {
          ok: false,
          models: [],
          error: `Ollama returned ${res.status}`,
        };
      const json = (await res.json()) as { models?: Array<{ name?: string }> };
      const models = (json.models ?? [])
        .map((m) => m.name)
        .filter((n): n is string => typeof n === 'string');
      return { ok: true, models };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, models: [], error: msg };
    }
  }

  // ---------------------------------------------------------------------------
  // Ollama 实现
  // ---------------------------------------------------------------------------

  private async embedOllama(texts: string[]): Promise<EmbeddingResult> {
    const embeddings: number[][] = [];
    let totalTokens = 0;

    for (const text of texts) {
      const { controller } = this.composeAbort(
        this.config.timeoutMs,
        'embedding timeout'
      );
      try {
        const res = await fetch(`${this.config.baseUrl}/api/embeddings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: this.config.model, prompt: text }),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(
            `Ollama embedding failed: ${res.status} ${res.statusText}`
          );
        }
        const json = (await res.json()) as { embedding?: number[] };
        if (!json.embedding || !Array.isArray(json.embedding)) {
          throw new Error('Ollama returned no embedding');
        }
        embeddings.push(json.embedding);
        totalTokens += json.embedding.length;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await handleError(err, {
          module: 'ai:embedding',
          action: 'embedOllama_fetch',
        });
        // KB-SEM-FIX（2026-08-28）：不再注入零向量占位——Ollama 不可用时原实现
        // 静默建出全零索引（搜索全无结果且无任何提示），改为抛错让上层（builder
        // 熔断机制）显式中止，与 OpenAI 远端路径行为一致
        logger.error('本地嵌入(Ollama)调用失败，中止当前批次', {
          baseUrl: this.config.baseUrl,
          model: this.config.model,
          error: msg,
        });
        throw new Error(
          `本地嵌入失败（Ollama ${this.config.baseUrl}, model=${this.config.model}）: ${msg}`
        );
      } finally {
        clearTimeout(
          (controller as unknown as Record<string, unknown>)._timer as
            | number
            | undefined
        );
      }
    }

    return {
      embeddings,
      model: this.config.model,
      usage: { promptTokens: texts.length, totalTokens },
    };
  }

  // ---------------------------------------------------------------------------
  // OpenAI-compat 实现
  // ---------------------------------------------------------------------------

  private async embedOpenAICompat(texts: string[]): Promise<EmbeddingResult> {
    const embeddings: number[][] = [];
    let totalTokens = 0;

    for (
      let batchStart = 0;
      batchStart < texts.length;
      batchStart += this.config.batchSize
    ) {
      const batch = texts.slice(batchStart, batchStart + this.config.batchSize);
      const { controller } = this.composeAbort(
        this.config.timeoutMs,
        'embedding timeout'
      );

      try {
        const body: Record<string, unknown> = {
          model: this.config.model,
          input: batch,
          ...this.config.extraBody,
        };

        const res = await fetch(`${this.config.baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`OpenAI embedding failed: ${res.status} ${errText}`);
        }

        const json = (await res.json()) as {
          data?: Array<{ embedding?: number[] }>;
          usage?: { total_tokens?: number };
        };

        for (const item of json.data ?? []) {
          if (item.embedding) {
            embeddings.push(item.embedding);
          }
        }

        if (json.usage?.total_tokens) {
          totalTokens += json.usage.total_tokens;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await handleError(err, {
          module: 'ai:embedding',
          action: 'embedOpenAICompat_fetch',
        });
        // KB-SEM-FIX（2026-08-28）：同 Ollama 路径——不再注入零向量占位，
        // 失败抛错让上层熔断可见
        logger.error('本地嵌入(OpenAI-compat)调用失败，中止当前批次', {
          baseUrl: this.config.baseUrl,
          model: this.config.model,
          error: msg,
        });
        throw new Error(
          `本地嵌入失败（OpenAI-compat ${this.config.baseUrl}, model=${this.config.model}）: ${msg}`
        );
      } finally {
        clearTimeout(
          (controller as unknown as Record<string, unknown>)._timer as
            | number
            | undefined
        );
      }
    }

    return {
      embeddings,
      model: this.config.model,
      usage: { promptTokens: texts.length, totalTokens },
    };
  }

  // ---------------------------------------------------------------------------
  // 工具函数
  // ---------------------------------------------------------------------------

  private composeAbort(
    timeoutMs: number,
    timeoutMsg: string
  ): { controller: AbortController } {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error(timeoutMsg)),
      timeoutMs
    );
    (
      controller as unknown as {
        signal?: { reason?: unknown };
        _timer?: ReturnType<typeof setTimeout>;
      }
    )._timer = timer;
    return { controller };
  }
}
