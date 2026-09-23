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
  // Ollama（非标准 /api/chat, /api/generate, /api/tags 路径）
  /^https?:\/\/.+\/api\/(chat|generate|tags|embeddings)/i,
];

/** 需要脱敏的请求头（整值替换，不留前缀） */
const SENSITIVE_HEADERS = new Set([
  'x-api-key',
  'authorization',
  'cookie',
  'set-cookie',
  'x-session-id',
]);

/** 需要脱敏的 URL 查询参数（凭据）：GoogleProvider 用 `?key=` 传 API Key */
const SENSITIVE_QUERY_PARAMS = new Set([
  'key',
  'api_key',
  'api-key',
  'apikey',
  'access_token',
  'token',
  'x-api-key',
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
 * 脱敏请求头（**整值替换**为 `***`）。
 *
 * 2026-09-23（Spec `trajectory-single-source-convergence.md` v0.2 §6-4）：原实现
 * "保留前 12 位 + `...`" 仍把凭据前缀写进 `traces/` 落盘文件（`Bearer sk-xx…`），
 * 属**部分凭据泄漏**；改为整值脱敏，敏感头**不保留任何字符**。
 *
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
      out[key] = '***';
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * 脱敏 URL 中的凭据查询参数（保留参数名与其它参数，值替换为 `***`）。
 *
 * 依据：`GoogleProvider` 把 API Key 放在 query（`?key=${apiKey}`），而 trace 记录
 * 会落 `upstreamBaseUrl` / `request.path` 的**完整 URL** ⇒ 不脱敏即"凭据落盘"。
 * 非 URL / 解析失败 ⇒ 原样返回（不因脱敏影响录制）。
 */
export function sanitizeUrl(url: string): string {
  const qIndex = url.indexOf('?');
  if (qIndex < 0) return url;
  try {
    const parsed = new URL(url);
    let changed = false;
    for (const name of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_PARAMS.has(name.toLowerCase())) {
        parsed.searchParams.set(name, '***');
        changed = true;
      }
    }
    return changed ? parsed.toString() : url;
  } catch {
    // 非标准 URL（如相对路径）⇒ 用字符串兜底替换参数值（模式由同一张表派生，避免漂移）
    return url.replace(SENSITIVE_QUERY_PARAM_PATTERN, '$1***');
  }
}

/** 兜底替换用的参数模式（由 `SENSITIVE_QUERY_PARAMS` 派生） */
const SENSITIVE_QUERY_PARAM_PATTERN = new RegExp(
  `([?&](?:${Array.from(SENSITIVE_QUERY_PARAMS).join('|')})=)[^&#]*`,
  'gi'
);

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
