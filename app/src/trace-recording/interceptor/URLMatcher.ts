/**
 * AI API 域名匹配器
 *
 * 通过 URL 模式匹配自动识别 AI API 调用。
 * 支持 allowlist（允许列表）和 blocklist（阻止列表）两种模式。
 */

/** AI API 域名模式 */
const AI_API_DOMAIN_PATTERNS: RegExp[] = [
  // Anthropic
  /^https?:\/\/api\.anthropic\.com\//i,
  /^https?:\/\/(.+\.)?anthropic\.com\/v1\//i,
  // OpenAI
  /^https?:\/\/api\.openai\.com\//i,
  /^https?:\/\/(.+\.)?openai\.azure\.com\//i,
  // DeepSeek
  /^https?:\/\/api\.deepseek\.com\//i,
  // Google / Gemini
  /^https?:\/\/generativelanguage\.googleapis\.com\//i,
  // AWS Bedrock (需要特殊处理，URL 模式不同)
  /^https?:\/\/bedrock-runtime\..+\.amazonaws\.com\//i,
  // Azure OpenAI
  /^https?:\/\/.+\.openai\.azure\.com\//i,
  // 通用 v1/chat/completions 模式
  /^https?:\/\/.+\/v1\/(chat\/completions|messages|embeddings|models)/i,
  // 通用 v1/responses 模式（OpenAI Responses API）
  /^https?:\/\/.+\/v1\/responses/i,
];

/** 需要脱敏的请求头 */
const SENSITIVE_HEADERS = new Set([
  'x-api-key',
  'authorization',
  'cookie',
  'set-cookie',
  'x-session-id',
]);

/**
 * 判断URL是否为AI API调用
 * @param url 请求URL
 * @returns 是否匹配
 */
export function isAIApiUrl(url: string): boolean {
  return AI_API_DOMAIN_PATTERNS.some((pattern) => pattern.test(url));
}

/**
 * 脱敏请求头
 * 将敏感头部的值替换为前N位+省略号
 * @param headers 原始请求头
 * @returns 脱敏后的请求头
 */
export function sanitizeHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_HEADERS.has(lower)) {
      out[key] = value.length > 12 ? value.slice(0, 12) + '...' : '***';
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * 过滤跳转头
 * 移除 hop-by-hop 头（不转发给上游）
 */
export function filterHopByHopHeaders(
  headers: Record<string, string>
): Record<string, string> {
  const HOP_BY_HOP = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
  ]);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * 从请求体中提取模型名称
 * @param body 请求体对象
 * @returns 模型名称（未知时返回 'unknown'）
 */
export function extractModelName(body: unknown): string {
  if (body && typeof body === 'object' && 'model' in body) {
    const model = (body as Record<string, unknown>).model;
    if (typeof model === 'string') {
      return model;
    }
  }
  return 'unknown';
}
