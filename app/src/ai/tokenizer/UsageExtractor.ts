/**
 * API Token 直接提取路径（Phase 5+）
 * 对标 cc-switch parser.rs + claude-tap SSEReassembler
 *
 * 从 Provider API 响应中直接提取 usage/token 信息，避免估算。
 * 支持 OpenAI / Anthropic / Gemini 等多格式。
 */
import { getLogger } from '@modules/monitoring';
const logger = getLogger('context:token:extract');

export interface ExtractedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  source: 'api' | 'header' | 'estimated';
  // [v1.2] 缓存 token 字段（三级回退：OpenAI / Anthropic / DeepSeek/GLM）
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

// [v1.2] 三级回退 cache 字段提取
function extractCacheTokens(usage: Record<string, unknown>): {
  cacheReadTokens: number;
  cacheCreationTokens: number;
} {
  const cacheRead =
    (usage.cache_read_input_tokens as number) ??
    (usage.cacheReadInputTokens as number) ??
    (usage.prompt_cache_hit_tokens as number) ??
    (usage.prompt_tokens_details as Record<string, number> | undefined)
      ?.cached_tokens ??
    0;
  const cacheCreation =
    (usage.cache_creation_input_tokens as number) ??
    (usage.cacheCreationInputTokens as number) ??
    (usage.prompt_cache_miss_tokens as number) ??
    0;
  return { cacheReadTokens: cacheRead, cacheCreationTokens: cacheCreation };
}

/**
 * 从 body 提取 token usage（OpenAI 格式）
 * CC 源码 update_model_usage() 模式
 */
export function extractOpenAIUsage(
  body: Record<string, unknown>
): ExtractedUsage | null {
  const usage = body.usage as Record<string, number> | undefined;
  if (!usage) return null;

  // OpenAI 原生格式: prompt_tokens + completion_tokens
  if (typeof usage.prompt_tokens === 'number') {
    const cache = extractCacheTokens(usage);
    return {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens ?? 0,
      totalTokens:
        usage.total_tokens ??
        usage.prompt_tokens + (usage.completion_tokens ?? 0),
      source: 'api',
      ...cache,
    };
  }

  // 内部归一化格式: inputTokens + outputTokens（如 UnifiedTokenTracker.recordPostRequest）
  if (typeof usage.inputTokens === 'number') {
    const cache = extractCacheTokens(usage);
    return {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens ?? 0,
      totalTokens:
        usage.totalTokens ?? usage.inputTokens + (usage.outputTokens ?? 0),
      source: 'api',
      ...cache,
    };
  }

  return null;
}

/**
 * 从 body 提取 Anthropic usage 格式
 */
export function extractAnthropicUsage(
  body: Record<string, unknown>
): ExtractedUsage | null {
  const usage = body.usage as Record<string, number> | undefined;
  if (usage && typeof usage.input_tokens === 'number') {
    const cache = extractCacheTokens(usage);
    return {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens ?? 0,
      totalTokens: usage.input_tokens + (usage.output_tokens ?? 0),
      source: 'api',
      ...cache,
    };
  }
  return null;
}

/**
 * 从 body 提取 Gemini usage 格式
 */
export function extractGeminiUsage(
  body: Record<string, unknown>
): ExtractedUsage | null {
  const meta = body.usageMetadata as Record<string, number> | undefined;
  if (meta && typeof meta.promptTokenCount === 'number') {
    return {
      inputTokens: meta.promptTokenCount,
      outputTokens: meta.candidatesTokenCount ?? 0,
      totalTokens:
        meta.totalTokenCount ??
        meta.promptTokenCount + (meta.candidatesTokenCount ?? 0),
      source: 'api',
      // Gemini 格式无专用 cache 字段，沿用默认 0
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };
  }
  return null;
}

/**
 * 从 body 提取 DeepSeek usage 格式（与 OpenAI 兼容但字段命名可能有差异）
 */
export function extractDeepSeekUsage(
  body: Record<string, unknown>
): ExtractedUsage | null {
  const usage = body.usage as Record<string, number> | undefined;
  if (
    usage &&
    (typeof usage.prompt_tokens === 'number' ||
      typeof usage.input_tokens === 'number')
  ) {
    const input = usage.prompt_tokens ?? usage.input_tokens ?? 0;
    const output = usage.completion_tokens ?? usage.output_tokens ?? 0;
    const cache = extractCacheTokens(usage);
    return {
      inputTokens: input,
      outputTokens: output,
      totalTokens: usage.total_tokens ?? input + output,
      source: 'api',
      ...cache,
    };
  }
  return null;
}

/**
 * 统一提取入口：自动检测格式（OpenAI → Anthropic → DeepSeek → Gemini）
 */
export function extractUsage(
  body: Record<string, unknown>
): ExtractedUsage | null {
  const result =
    extractOpenAIUsage(body) ??
    extractAnthropicUsage(body) ??
    extractDeepSeekUsage(body) ??
    extractGeminiUsage(body);
  if (!result) {
    logger.debug('extractUsage: unknown format, returning null');
  }
  return result;
}

/**
 * 从 SSE chunk 增量提取（claude-tap SSEReassembler 模式）
 * 用于流式响应中 in-flight 计算 accumulated tokens
 */
export function extractSSEChunkUsage(
  chunk: Record<string, unknown>
): { outputTokens?: number } | null {
  // OpenAI SSE chunk: { choices: [{ delta: { content: "..." } }], usage?: { ... } }
  const usage = chunk.usage as Record<string, number> | undefined;
  if (usage?.completion_tokens != null) {
    return { outputTokens: usage.completion_tokens };
  }
  if (usage?.output_tokens != null) {
    return { outputTokens: usage.output_tokens };
  }
  return null;
}
