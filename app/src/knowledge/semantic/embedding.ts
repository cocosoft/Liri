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
 * 语义向量嵌入客户端
 *
 * 支持两种后端:
 *   - Ollama (本地): 默认 http://localhost:11434, 模型 nomic-embed-text
 *   - OpenAI-compat: 兼容 OpenAI embedding API 的服务
 *
 * 借鉴: DeepSeek-Reasonix src/index/semantic/embedding.ts
 */

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_EMBED_MODEL = 'nomic-embed-text';
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_BATCH_SIZE = 10;

/** 嵌入选项 */
export type EmbedOptions =
  | {
      provider?: 'ollama';
      baseUrl?: string;
      model?: string;
      timeoutMs?: number;
      signal?: AbortSignal;
    }
  | {
      provider: 'openai-compat';
      baseUrl: string;
      apiKey: string;
      model: string;
      extraBody?: Record<string, unknown>;
      timeoutMs?: number;
      batchSize?: number;
      signal?: AbortSignal;
    };

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { configManager } from '@modules/config';

/** 嵌入错误 */
export class EmbeddingError extends AppError {
  constructor(
    message: string,
    cause?: unknown,
  ) {
    super(message, ErrorCategory.DATA, ErrorSeverity.MEDIUM);
    this.name = 'EmbeddingError';
    if (cause instanceof Error) this.cause = cause;
  }
}

/**
 * 对单个文本生成嵌入向量
 */
export async function embed(text: string, opts: EmbedOptions = {}): Promise<Float32Array> {
  if (opts.provider === 'openai-compat') return await embedOpenAICompat(text, opts);
  return await embedOllama(text, opts);
}

/**
 * 批量生成嵌入向量
 */
export async function embedAll(
  texts: readonly string[],
  opts: EmbedOptions & {
    onProgress?: (done: number, total: number) => void;
    onError?: (index: number, err: unknown) => void;
  } = {},
): Promise<Array<Float32Array | null>> {
  if (opts.provider === 'openai-compat') return await embedAllOpenAICompat(texts, opts);
  const out: Array<Float32Array | null> = [];
  for (let i = 0; i < texts.length; i++) {
    if (opts.signal?.aborted) throw new EmbeddingError('embedding aborted');
    const text = texts[i];
    if (text === undefined) continue;
    try {
      out.push(await embed(text, opts));
    } catch (err) {
      if (isAbortError(err) || opts.signal?.aborted) {
        throw new EmbeddingError('embedding aborted', err);
      }
      opts.onError?.(i, err);
      out.push(null);
    }
    opts.onProgress?.(i + 1, texts.length);
  }
  return out;
}

/**
 * 探测 Ollama 服务可用性
 */
export async function probeOllama(
  opts: { baseUrl?: string; signal?: AbortSignal } = {},
): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  const baseUrl = opts.baseUrl ?? configManager.env('OLLAMA_URL') ?? DEFAULT_OLLAMA_URL;
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: opts.signal });
    if (!res.ok) return { ok: false, error: `Ollama returned ${res.status}` };
    const json = (await res.json()) as { models?: Array<{ name?: string }> };
    const models = (json.models ?? [])
      .map((m) => m.name)
      .filter((n): n is string => typeof n === 'string');
    return { ok: true, models };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

// ─── Ollama 实现 ─────────────────────────────────────────────────────────────

async function embedOllama(
  text: string,
  opts: Extract<EmbedOptions, { provider?: 'ollama' }>,
): Promise<Float32Array> {
  const baseUrl = opts.baseUrl ?? configManager.env('OLLAMA_URL') ?? DEFAULT_OLLAMA_URL;
  const model = opts.model ?? configManager.env('EMBED_MODEL') ?? DEFAULT_EMBED_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { controller } = composeAbort(opts.signal, timeoutMs, 'embedding timeout');

  const res = await fetch(`${baseUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt: text }),
    signal: controller.signal,
  });

  if (!res.ok) {
    throw new EmbeddingError(`Ollama embedding failed: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { embedding?: number[] };
  if (!json.embedding || !Array.isArray(json.embedding)) {
    throw new EmbeddingError('Ollama returned no embedding');
  }
  return new Float32Array(json.embedding);
}

// ─── OpenAI-compat 实现 ──────────────────────────────────────────────────────

async function embedOpenAICompat(
  text: string,
  opts: Extract<EmbedOptions, { provider: 'openai-compat' }>,
): Promise<Float32Array> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { controller } = composeAbort(opts.signal, timeoutMs, 'embedding timeout');

  const body: Record<string, unknown> = {
    model: opts.model,
    input: text,
    ...(opts.extraBody ?? {}),
  };

  const res = await fetch(`${opts.baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new EmbeddingError(`OpenAI embedding failed: ${res.status} ${errText}`);
  }
  const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
  const embedding = json.data?.[0]?.embedding;
  if (!embedding || !Array.isArray(embedding)) {
    throw new EmbeddingError('OpenAI returned no embedding');
  }
  return new Float32Array(embedding);
}

async function embedAllOpenAICompat(
  texts: readonly string[],
  opts: EmbedOptions & {
    onProgress?: (done: number, total: number) => void;
    onError?: (index: number, err: unknown) => void;
  },
): Promise<Array<Float32Array | null>> {
  const batchSize = (opts as Extract<EmbedOptions, { provider: 'openai-compat' }>).batchSize ?? DEFAULT_BATCH_SIZE;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const out: Array<Float32Array | null> = [];

  for (let batchStart = 0; batchStart < texts.length; batchStart += batchSize) {
    const batch = texts.slice(batchStart, batchStart + batchSize);
    const { controller } = composeAbort(opts.signal, timeoutMs, 'embedding timeout');

    const body = {
      model: (opts as Extract<EmbedOptions, { provider: 'openai-compat' }>).model,
      input: batch,
      ...((opts as Extract<EmbedOptions, { provider: 'openai-compat' }>).extraBody ?? {}),
    };

    try {
      const res = await fetch(
        `${(opts as Extract<EmbedOptions, { provider: 'openai-compat' }>).baseUrl}/embeddings`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${(opts as Extract<EmbedOptions, { provider: 'openai-compat' }>).apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );

      if (!res.ok) throw new EmbeddingError(`batch embedding failed: ${res.status}`);
      const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
      for (const item of json.data ?? []) {
        out.push(item.embedding ? new Float32Array(item.embedding) : null);
      }
    } catch (err) {
      for (let i = 0; i < batch.length; i++) {
        out.push(null);
        opts.onError?.(batchStart + i, err);
      }
    }
    opts.onProgress?.(Math.min(batchStart + batchSize, texts.length), texts.length);
  }
  return out;
}

// ─── 工具函数 ────────────────────────────────────────────────────────────────

function composeAbort(
  signal: AbortSignal | undefined,
  timeoutMs: number,
  timeoutMsg: string,
): { controller: AbortController } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(timeoutMsg)), timeoutMs);
  const onAbort = () => {
    clearTimeout(timer);
    controller.abort();
  };
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      controller.abort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }
  return { controller };
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}