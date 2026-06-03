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
 * 模型列表获取服务
 * 对标 CC 源码 cc-switch/src-tauri/src/services/model_fetch.rs 实现
 *
 * 通过 OpenAI 兼容的 GET /v1/models 端点获取供应商可用模型列表。
 * 支持智能候选 URL 生成（剥离 Anthropic 兼容子路径）。
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

const FETCH_TIMEOUT_MS = 15000;

/** 获取到的模型信息 */
export interface FetchedModel {
  id: string;
  ownedBy?: string;
}

/** 已知的 Anthropic 协议兼容子路径后缀 */
const KNOWN_COMPAT_SUFFIXES: string[] = [
  '/api/claudecode',
  '/api/anthropic',
  '/apps/anthropic',
  '/api/coding',
  '/claudecode',
  '/anthropic',
  '/step_plan',
  '/coding',
  '/claude',
];

/**
 * 构造模型列表端点候选 URL
 * 对标 cc-switch model_fetch.rs::build_models_url_candidates
 */
function buildCandidates(
  baseUrl: string,
  modelsUrlOverride?: string
): string[] {
  if (modelsUrlOverride) {
    return [modelsUrlOverride];
  }

  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return [];

  const candidates: string[] = [];

  // 主候选：直接拼接 /v1/models
  if (trimmed.endsWith('/v1')) {
    candidates.push(`${trimmed}/models`);
  } else {
    candidates.push(`${trimmed}/v1/models`);
  }

  // 兜底候选：剥离 Anthropic 兼容子路径
  for (const suffix of KNOWN_COMPAT_SUFFIXES) {
    if (trimmed.endsWith(suffix)) {
      const stripped = trimmed.slice(0, -suffix.length);
      if (stripped && stripped.includes('://')) {
        candidates.push(`${stripped}/v1/models`);
        candidates.push(`${stripped}/models`); // DeepSeek 官方只暴露 /models
      }
      break;
    }
  }

  // 去重
  return [...new Set(candidates)];
}

/**
 * 获取供应商可用模型列表
 * 依次尝试候选 URL，直到成功
 */
export async function fetchModels(
  baseUrl: string,
  apiKey: string,
  modelsUrlOverride?: string
): Promise<{ models: FetchedModel[]; usedUrl: string } | { error: string }> {
  if (!apiKey) {
    return { error: 'API Key is required to fetch models' };
  }

  const candidates = buildCandidates(baseUrl, modelsUrlOverride);

  if (candidates.length === 0) {
    return { error: 'Base URL is empty' };
  }

  let lastError: string | undefined;

  for (const url of candidates) {
    logger.debug(`[ModelFetch] Trying: ${url}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.status === 404 || response.status === 405) {
        lastError = `HTTP ${response.status} at ${url}`;
        continue;
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return { error: `HTTP ${response.status}: ${body.substring(0, 200)}` };
      }

      const data = (await response.json()) as {
        data?: Array<{ id: string; owned_by?: string }>;
      };

      if (!data?.data || !Array.isArray(data.data)) {
        return { error: 'Invalid response format' };
      }

      const models: FetchedModel[] = data.data
        .map((m) => ({ id: m.id, ownedBy: m.owned_by }))
        .sort((a, b) => a.id.localeCompare(b.id));

      logger.info(`[ModelFetch] 成功获取 ${models.length} 个模型 from ${url}`);
      return { models, usedUrl: url };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('aborted')) {
        lastError = `Timeout at ${url}`;
      } else {
        lastError = msg;
      }
    }
  }

  return { error: `All candidates failed: ${lastError || 'no candidates'}` };
}

export const ModelFetcher = { fetchModels, buildCandidates };
