/**
 * friendlyError.ts — 将技术异常翻译为用户可读的中文提示
 *
 * 适用于 fetch 网络错误、SSE 断连等场景。
 * 返回格式： "人看得懂的信息" + "\n\n（原异常信息）"
 */

import i18n from "../i18n";

/** 常见网络错误 → 中文映射 */
const NETWORK_ERROR_MAP: Array<[RegExp, string]> = [
  [/socket connection was closed unexpectedly/i, "errors.networkInterrupted"],
  [/Failed to fetch/i, "errors.fetchFailed"],
  [/NetworkError/i, "errors.networkError"],
  [/ERR_CONNECTION_REFUSED/i, "errors.serverUnresponsive"],
  [/ECONNREFUSED/i, "errors.connectionRefused"],
  [/timeout/i, "errors.timeout"],
  [/aborted/i, "errors.cancelled"],
  [/Load failed/i, "errors.loadFailed"],
  [/Unexpected token.*JSON/i, "errors.badJson"],
  // P3-2 修复：泛化 5xx/4xx 要求状态码语境前缀（status/HTTP/error 邻近），
  // 避免 "已处理 500 条记录" 式误匹配；捕获组用于替换 {code} 占位符
  [/(?:status|http|error)[^\d]{0,20}(5\d{2})\b/i, "errors.serverInternal"],
  [/(?:status|http|error)[^\d]{0,20}(4\d{2})\b/i, "errors.badRequest"],
];

/** HTTP 状态码 → 中文 */
const HTTP_STATUS_MAP: Record<number, string> = {
  400: "errors.http400",
  401: "errors.http401",
  403: "errors.http403",
  404: "errors.http404",
  408: "errors.http408",
  429: "errors.http429",
  500: "errors.http500",
  502: "errors.http502",
  503: "errors.http503",
  504: "errors.http504",
};

/**
 * 业务/模型服务特定错误 → 中文提示（在 HTTP 状态码检查之前匹配）
 *
 * 实证来源：真实会话导出 chat-export-*.md（23:09/23:12）与云端模型实测——
 * 模型服务错误常以文本形式出现（如 "OpenAI stream error (400): {...Model does not exist...}"），
 * 若先匹配 HTTP 400 会误判为"请求参数有误"，需高优先级精确匹配。
 */
const SPECIFIC_ERROR_MAP: Array<[RegExp, string]> = [
  [
    /model does not exist|model not found|model_not_found|no such model|invalid model|model.*not available/i,
    "errors.modelNotFound",
  ],
  [
    /certificate|ssl|tls|unable to connect|is the computer able to access|FailedToOpenSocket/i,
    "errors.modelUnreachable",
  ],
  [/api[- ]?key|incorrect.*key|invalid.*key|unauthorized/i, "errors.modelAuth"],
  [
    /rate limit|quota|insufficient.*(quota|balance)|payment required/i,
    "errors.modelQuota",
  ],
  [
    /context.*(length|limit|exceed)|n_ctx|context window.*(exceed|too (small|large))/i,
    "errors.contextTooLong",
  ],
];

/**
 * 从异常对象中提取原始错误信息
 */
export function getRawErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return i18n.t("errors.unknown");
}

/**
 * 从异常中提取 HTTP 状态码（如果有）
 */
function extractHttpStatus(error: unknown): number | null {
  const msg = getRawErrorMessage(error);
  // P3-2 修复：优先语境前缀匹配（status/HTTP/error 邻近）；
  // 裸三位数仅当是已知 HTTP 状态码才采纳，避免任意三位数误匹配
  const ctx = msg.match(
    /(?:status(?:\s*code)?|http|error)\s*[:：(]?\s*(\d{3})\b/i,
  );
  if (ctx) return parseInt(ctx[1], 10);
  const bare = msg.match(/\b(\d{3})\b/);
  if (bare && Number(bare[1]) in HTTP_STATUS_MAP) {
    return parseInt(bare[1], 10);
  }
  return null;
}

function withOriginalInfo(message: string, raw: string): string {
  return `${message}\n\n${i18n.t("errors.originalError", { raw })}`;
}

/**
 * 将技术异常翻译为用户可读的中文提示
 *
 * @returns "人看得懂的信息\n\n（原异常信息）"
 *
 * @example
 * friendlyErrorMessage(new Error("Failed to fetch"))
 * // "无法连接到服务器，请确认服务是否在运行\n\n（原异常信息：Failed to fetch）"
 */
export function friendlyErrorMessage(error: unknown): string {
  const raw = getRawErrorMessage(error);

  // 0. 业务/模型服务特定错误优先（避免 HTTP 400 误判"参数有误"等）
  for (const [pattern, key] of SPECIFIC_ERROR_MAP) {
    if (pattern.test(raw)) {
      return withOriginalInfo(i18n.t(key), raw);
    }
  }

  // 1. 再查 HTTP 状态码
  const status = extractHttpStatus(error);
  if (status && HTTP_STATUS_MAP[status]) {
    return withOriginalInfo(i18n.t(HTTP_STATUS_MAP[status]), raw);
  }

  // 2. 再查网络错误模式（P3-2：替换 {code} 占位符为实际捕获的状态码）
  for (const [pattern, key] of NETWORK_ERROR_MAP) {
    const m = raw.match(pattern);
    if (m) {
      return withOriginalInfo(i18n.t(key, { code: m[1] ?? "" }), raw);
    }
  }

  // 3. 没有匹配，返回原文
  return withOriginalInfo(i18n.t("errors.operationFailed"), raw);
}

/**
 * 生成简短的友好错误摘要（不含原始信息，适合 Toast）
 */
export function friendlyErrorSummary(error: unknown): string {
  const full = friendlyErrorMessage(error);
  const idx = full.indexOf("\n\n");
  return idx > 0 ? full.slice(0, idx) : full;
}
