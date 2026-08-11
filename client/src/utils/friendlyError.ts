/**
 * friendlyError.ts — 将技术异常翻译为用户可读的中文提示
 *
 * 适用于 fetch 网络错误、SSE 断连等场景。
 * 返回格式： "人看得懂的信息" + "\n\n（原异常信息）"
 */

/** 常见网络错误 → 中文映射 */
const NETWORK_ERROR_MAP: Array<[RegExp | string, string]> = [
  [
    /socket connection was closed unexpectedly/i,
    "网络连接意外中断，请检查网络后重试",
  ],
  [/Failed to fetch/i, "无法连接到服务器，请确认服务是否在运行"],
  [/NetworkError/i, "网络异常，请检查网络连接"],
  [/ERR_CONNECTION_REFUSED/i, "服务器未响应，请确认后端已启动"],
  [/ECONNREFUSED/i, "服务器拒绝连接，请确认后端已启动"],
  [/timeout/i, "请求超时，服务器响应过慢或网络不稳定"],
  [/aborted/i, "请求已被取消"],
  [/Load failed/i, "资源加载失败，请刷新页面重试"],
  [/Unexpected token.*JSON/i, "服务器返回了异常数据，请稍后重试"],
  [/5\d\d/ as unknown as string, "服务器内部错误（{code}），请稍后重试"],
  [/4\d\d/ as unknown as string, "请求有误（{code}），请检查参数"],
];

/** HTTP 状态码 → 中文 */
const HTTP_STATUS_MAP: Record<number, string> = {
  400: "请求参数有误",
  401: "登录已过期，请重新登录",
  403: "没有权限访问",
  404: "请求的资源不存在",
  408: "请求超时",
  429: "请求过于频繁，请稍后重试",
  500: "服务器内部错误",
  502: "网关错误",
  503: "服务暂时不可用",
  504: "网关超时",
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
    "模型不存在或已被移除，请在模型管理中选择可用模型",
  ],
  [
    /certificate|ssl|tls/i,
    "模型服务 SSL 证书校验失败，请检查 API 地址是否为 HTTPS 且证书有效",
  ],
  [
    /unable to connect|is the computer able to access/i,
    "无法连接到模型服务，请检查网络或 API 地址",
  ],
  [
    /api[- ]?key|incorrect.*key|invalid.*key|unauthorized/i,
    "模型服务认证失败，请检查 API Key 是否正确",
  ],
  [
    /rate limit|quota|insufficient.*(quota|balance)|payment required/i,
    "模型服务额度不足或触发限流，请检查账户余额或稍后重试",
  ],
  [
    /context.*(length|limit|exceed)|n_ctx|context window.*(exceed|too (small|large))/i,
    "上下文长度超出模型限制，请精简对话或切换更大上下文的模型",
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
  return "未知错误";
}

/**
 * 从异常中提取 HTTP 状态码（如果有）
 */
function extractHttpStatus(error: unknown): number | null {
  const msg = getRawErrorMessage(error);
  const match =
    msg.match(/status(?: code)?[: ]?(\d{3})/i) ||
    msg.match(/\b(5\d\d|4\d\d)\b/);
  return match ? parseInt(match[1], 10) : null;
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
  for (const [pattern, friendly] of SPECIFIC_ERROR_MAP) {
    if (pattern.test(raw)) {
      return `${friendly}\n\n（原异常信息：${raw}）`;
    }
  }

  // 1. 再查 HTTP 状态码
  const status = extractHttpStatus(error);
  if (status && HTTP_STATUS_MAP[status]) {
    return `${HTTP_STATUS_MAP[status]}\n\n（原异常信息：${raw}）`;
  }

  // 2. 再查网络错误模式
  for (const [pattern, friendly] of NETWORK_ERROR_MAP) {
    if (pattern instanceof RegExp) {
      if (pattern.test(raw)) {
        return `${friendly}\n\n（原异常信息：${raw}）`;
      }
    } else if (raw.includes(pattern)) {
      return `${friendly}\n\n（原异常信息：${raw}）`;
    }
  }

  // 3. 没有匹配，返回原文
  return `操作异常\n\n（原异常信息：${raw}）`;
}

/**
 * 生成简短的友好错误摘要（不含原始信息，适合 Toast）
 */
export function friendlyErrorSummary(error: unknown): string {
  const full = friendlyErrorMessage(error);
  const idx = full.indexOf("\n\n（");
  return idx > 0 ? full.slice(0, idx) : full;
}
