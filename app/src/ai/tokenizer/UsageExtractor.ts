/**
 * API Token 直接提取路径（Phase 5+）
 * 对标 cc-switch parser.rs + claude-tap SSEReassembler
 *
 * 从 Provider API 响应中直接提取 usage/token 信息，避免估算。
 * 支持 OpenAI / Anthropic / Gemini 等多格式。
 */
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'context:token:extract',
  level: LogLevel.INFO,
});

export interface ExtractedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  source: 'api' | 'header' | 'estimated';
}

/**
 * 从 body 提取 token usage（OpenAI 格式）
 * CC 源码 update_model_usage() 模式
 */
export function extractOpenAIUsage(
  body: Record<string, unknown>
): ExtractedUsage | null {
  const usage = body.usage as Record<string, number> | undefined;
  if (usage && typeof usage.prompt_tokens === 'number') {
    return {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens ?? 0,
      totalTokens:
        usage.total_tokens ??
        usage.prompt_tokens + (usage.completion_tokens ?? 0),
      source: 'api',
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
    return {
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens ?? 0,
      totalTokens: usage.input_tokens + (usage.output_tokens ?? 0),
      source: 'api',
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
    return {
      inputTokens: input,
      outputTokens: output,
      totalTokens: usage.total_tokens ?? input + output,
      source: 'api',
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
