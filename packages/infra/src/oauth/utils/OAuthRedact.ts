// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * OAuth 敏感参数日志脱敏工具
 *
 * 对标: cc_code SENSITIVE_OAUTH_PARAMS + redactSensitiveUrlParams
 * 在日志中自动脱敏 OAuth 相关敏感参数，防止 access_token、code 等泄露到日志文件。
 */

/** OAuth URL 中的敏感查询参数 */
const SENSITIVE_OAUTH_PARAMS = new Set([
  'code',
  'state',
  'nonce',
  'code_challenge',
  'code_verifier',
  'client_secret',
  'access_token',
  'refresh_token',
  'id_token',
]);

/**
 * 脱敏 URL 中的 OAuth 敏感参数
 *
 * 例: https://example.com/callback?code=abc123&state=xyz&other=ok
 *   → https://example.com/callback?code=***&state=***&other=ok
 */
export function redactSensitiveUrlParams(url: string): string {
  try {
    const parsed = new URL(url);
    for (const [key] of parsed.searchParams) {
      if (SENSITIVE_OAUTH_PARAMS.has(key)) {
        parsed.searchParams.set(key, '***');
      }
    }
    return parsed.toString();
  } catch {
    // 无效 URL 时直接返回原始字符串
    return url;
  }
}

/**
 * 脱敏 OAuth 请求体中的敏感字段
 */
export function redactSensitiveBody(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return body;
  if (Array.isArray(body)) return body.map(redactSensitiveBody);

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    redacted[key] = SENSITIVE_OAUTH_PARAMS.has(key) ? '***' : value;
  }
  return redacted;
}
