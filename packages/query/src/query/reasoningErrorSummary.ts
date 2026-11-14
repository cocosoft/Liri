// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 推理阶段错误的**用户可读摘要**（P1-3，2026-11-06）
 *
 * **真机问题**（`dev_docs/20261106/俄罗斯方块长程会话导出排查-20261106.md` §29 P1-3）：
 * `reasoning_error` 收尾时 `state.lastError = String(err)` ⇒ 助手消息正文直接是
 * `AppError: OpenAI API error (400): {"error":…}` —— 用户看到一坨协议原文，既不知道
 * 发生了什么，也不知道下一步该做什么。
 *
 * **口径**：正文只给「哪一类问题 + 该做什么」；原始错误仍由 `handleError()` 与
 * `reActLoop:reasoning_error` 日志完整保留（排查不缺证据）。
 *
 * ⚠️ 为什么这里用文本匹配：provider 的错误体（OpenAI 兼容 `{"error":{…}}`）**只有文本**，
 * 没有结构化状态码字段（`OpenAIProvider` 抛的是
 * `AppError('OpenAI API error (<status>): <body>')`）。CS02 约束的是「用自家界面文案判状态」，
 * 不适用于解析**外部**服务的错误报文；即便如此仍优先取 `(NNN)` 状态码，文本只作兜底。
 */

/** 状态码提取（`OpenAI API error (400): …` / `HTTP 429`） */
function extractStatusCode(raw: string): number | undefined {
  const m =
    /\((?:HTTP\s*)?(\d{3})\)/i.exec(raw) ?? /\bHTTP\s+(\d{3})\b/i.exec(raw);
  if (!m) return undefined;
  const code = Number(m[1]);
  return Number.isFinite(code) ? code : undefined;
}

/**
 * 推理错误 ⇒ 用户可读摘要。
 *
 * @param err 推理阶段抛出的错误（`unknown` 由调用方保证）
 * @returns 面向用户的一两句话（不含堆栈、不含 provider 原始 JSON）
 */
export function summarizeReasoningError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const status = extractStatusCode(raw);

  // ① 工具/结果配对破坏（P0-2 修复后仍可能由第三方历史数据触发）
  if (/tool_calls|Messages with role 'tool'/i.test(raw)) {
    return (
      '本轮消息序列不符合模型协议（工具结果缺少对应的工具调用声明），已中止本轮。' +
      '发送新消息即可继续；若同一会话反复出现，请反馈该会话。'
    );
  }
  // ② 上下文超窗
  if (
    /context length|maximum context|context_length_exceeded|too many tokens/i.test(
      raw
    )
  ) {
    return '上下文已超出模型窗口上限：请精简历史（或新开会话），也可改用上下文窗口更大的模型。';
  }
  // ③ 鉴权
  if (status === 401 || status === 403) {
    return `模型服务鉴权失败（${status}）：请检查该供应商的 API Key 与权限配置后重试。`;
  }
  // ④ 限流
  if (status === 429) {
    return '模型请求被限流（429）：请稍后重试，或降低并发 / 提升该供应商配额。';
  }
  // ⑤ 服务端故障
  if (status !== undefined && status >= 500) {
    return `模型服务暂时不可用（${status}）：请稍后重试；持续失败请检查供应商状态页。`;
  }
  // ⑥ 网络层
  if (
    /timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(
      raw
    )
  ) {
    return '模型请求网络异常（超时或连接中断）：请检查网络 / 代理设置后重试。';
  }
  // ⑦ 兜底：保留原文首行（截断），至少让用户看到可辨识的信息
  const firstLine = raw.split(/\r?\n/)[0]?.trim() ?? '';
  return firstLine
    ? `本轮推理失败：${firstLine.slice(0, 240)}`
    : '本轮推理失败（未返回错误详情），请重试；若持续失败请查看日志。';
}
