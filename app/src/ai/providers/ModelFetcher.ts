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
 *
 * 通过 OpenAI 兼容的 GET /v1/models 端点获取供应商可用模型列表。
 * 支持智能候选 URL 生成（剥离 Anthropic 兼容子路径）。
 * 支持本地供应商（Ollama、LM Studio、LocalAI）的特殊处理。
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

const FETCH_TIMEOUT_MS = 15000;

/** 获取到的模型信息 */
export interface FetchedModel {
  id: string;
  ownedBy?: string;
}

/** 分页选项 */
export interface FetchModelsOptions {
  page?: number;
  pageSize?: number;
  search?: string;
}

/** 获取模型列表的返回结果 */
export interface FetchModelsResult {
  models: FetchedModel[];
  usedUrl: string;
  total: number;
  page: number;
  pageSize: number;
}

/**
 * 本地供应商类型列表
 * 这些供应商运行在本地，通常不需要 API Key
 */
export const LOCAL_PROVIDER_TYPES = ['ollama', 'lmstudio', 'localai'] as const;

export type LocalProviderType = typeof LOCAL_PROVIDER_TYPES[number];

/**
 * 判断是否为本地供应商
 */
export function isLocalProvider(providerType?: string): providerType is LocalProviderType {
  return LOCAL_PROVIDER_TYPES.includes(providerType as LocalProviderType);
}

/**
 * 获取本地供应商的模型列表端点
 */
function getLocalProviderModelsEndpoint(providerType: LocalProviderType, baseUrl: string): string {
  let url = baseUrl.replace(/\/+$/, '');
  // 移除可能存在的 /v1 后缀（Ollama 使用 /api/tags，不需要 /v1）
  if (providerType === 'ollama' && url.endsWith('/v1')) {
    url = url.slice(0, -3);
  }
  switch (providerType) {
    case 'ollama':
      return `${url}/api/tags`;
    case 'lmstudio':
    case 'localai':
    default:
      return `${url}/v1/models`;
  }
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

  // 额外候选：直接尝试 /models（DeepSeek 官方只暴露 /models）
  // 对于不以 /v1 结尾的 URL，也尝试直接拼接 /models
  if (!trimmed.endsWith('/v1')) {
    candidates.push(`${trimmed}/models`);
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
 * 获取本地供应商模型列表
 * 本地供应商不需要 API Key
 */
async function fetchLocalProviderModels(
  baseUrl: string,
  providerType: LocalProviderType,
  options: FetchModelsOptions = {}
): Promise<FetchModelsResult | { error: string }> {
  const { page = 1, pageSize = 50, search } = options;
  const url = getLocalProviderModelsEndpoint(providerType, baseUrl);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return { error: `HTTP ${response.status}: ${body.substring(0, 200)}` };
    }

    const data = await response.json();

    // Ollama 返回格式: { models: [{ name: "model-name" }] }
    // LM Studio/LocalAI 返回格式: { data: [{ id: "model-id", owned_by: "..." }] }
    let allModels: FetchedModel[];

    if (providerType === 'ollama') {
      const ollamaData = data as { models?: Array<{ name: string }> };
      if (!ollamaData?.models || !Array.isArray(ollamaData.models)) {
        return { error: 'Invalid Ollama response format' };
      }
      allModels = ollamaData.models
        .map((m) => ({ id: m.name, ownedBy: 'ollama' }))
        .sort((a, b) => a.id.localeCompare(b.id));
    } else {
      // LM Studio / LocalAI - 标准 OpenAI 格式
      const openaiData = data as { data?: Array<{ id: string; owned_by?: string }> };
      if (!openaiData?.data || !Array.isArray(openaiData.data)) {
        return { error: 'Invalid response format' };
      }
      allModels = openaiData.data
        .map((m) => ({ id: m.id, ownedBy: m.owned_by || providerType }))
        .sort((a, b) => a.id.localeCompare(b.id));
    }

    // 搜索过滤
    if (search) {
      const lowerSearch = search.toLowerCase();
      allModels = allModels.filter((m) => m.id.toLowerCase().includes(lowerSearch));
    }

    // 分页
    const total = allModels.length;
    const start = (page - 1) * pageSize;
    const models = allModels.slice(start, start + pageSize);

    logger.info(`[ModelFetch] ${providerType} 成功获取 ${total} 个模型 (显示 ${models.length} 个) from ${url}`);
    return { models, usedUrl: url, total, page, pageSize };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg };
  }
}

/**
 * 获取供应商可用模型列表
 * 依次尝试候选 URL，直到成功
 * 支持本地供应商（无需 API Key）和分页
 */
export async function fetchModels(
  baseUrl: string,
  apiKey: string,
  modelsUrlOverride?: string,
  providerType?: string,
  options: FetchModelsOptions = {}
): Promise<FetchModelsResult | { error: string }> {
  const { page = 1, pageSize = 50, search } = options;

  // 本地供应商特殊处理 - 跳过 API Key 校验
  if (isLocalProvider(providerType)) {
    return await fetchLocalProviderModels(baseUrl, providerType, options);
  }

  // 云供应商需要 API Key
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

      let allModels: FetchedModel[] = data.data
        .map((m) => ({ id: m.id, ownedBy: m.owned_by }))
        .sort((a, b) => a.id.localeCompare(b.id));

      // 搜索过滤
      if (search) {
        const lowerSearch = search.toLowerCase();
        allModels = allModels.filter((m) => m.id.toLowerCase().includes(lowerSearch));
      }

      // 分页
      const total = allModels.length;
      const start = (page - 1) * pageSize;
      const models = allModels.slice(start, start + pageSize);

      logger.info(`[ModelFetch] 成功获取 ${total} 个模型 (显示 ${models.length} 个) from ${url}`);
      return { models, usedUrl: url, total, page, pageSize };
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

export const ModelFetcher = { fetchModels, buildCandidates, isLocalProvider, LOCAL_PROVIDER_TYPES };
