/**
 * toolErrorMessages — 工具执行异常 → 用户友好提示映射（R04-001 文件拆分）
 *
 * 从 streamMessageFlow.ts 拆出（getToolExecErrorMessage 为纯函数，无依赖），
 * 过滤 OpenAI SDK/fetch 级技术错误，不暴露实现细节。
 */

/**
 * 出口网络不可用类错误（DNS 解析失败 / 拒绝连接 / 连接超时 / fetch 级失败）。
 *
 * P1-6（2026-11-05）：**单一判据**供两个面共用 —— 工具执行面（`getToolExecErrorMessage`）
 * 与模型请求面（`getLlmNetworkErrorMessage`）。分开各写一份必然漂移（CS01）。
 */
export function isNetworkUnavailableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  return (
    lower.includes('fetch failed') ||
    lower.includes('econnrefused') ||
    lower.includes('etimedout') ||
    lower.includes('enotfound') ||
    lower.includes('eai_again') ||
    lower.includes('getaddrinfo') ||
    lower.includes('network is unreachable')
  );
}

/**
 * P1-6（2026-11-05）：**模型请求**因出口网络不可用而失败时，用户可见的提示。
 *
 * 真机背景（2026-11-05 13:29Z，旧日志 27 次）：`getaddrinfo ENOTFOUND api.deepseek.com`
 * 重试耗尽后，前端只看到 `流式响应中断: fetch failed` —— 既没说明"这是网络断了"，
 * 也没给可执行动作；同时刻钉钉/QQ 长连接一起掉线，实为**出口网络中断**（非配置错误）。
 *
 * 边界：**只替换用户可见文案**；`system/error` 事件与日志仍用原始 error（诊断不能降级）。
 * 非网络失败（认证/限流/上下文溢出…）⇒ 返回 `null`，由调用方保留原口径。
 */
export function getLlmNetworkErrorMessage(err: unknown): string | null {
  if (!isNetworkUnavailableError(err)) return null;
  const raw = (err instanceof Error ? err.message : String(err)).slice(0, 120);
  return (
    `模型服务网络不可用：无法解析或连接模型服务地址（${raw}）。` +
    '请检查网络连接、代理设置与模型服务地址配置；网络恢复后重新发送即可继续。'
  );
}

/**
 * P1-6：流式中断的**用户可见正文**（网络不可用 ⇒ 专门文案；否则保留原口径）。
 *
 * 抽成一处是为了让调用点保持一行（`streamMessageFlow.ts` 有文件行数棘轮）。
 */
export function getStreamInterruptContent(
  err: unknown,
  fallbackMessage: string
): string {
  return getLlmNetworkErrorMessage(err) ?? `流式响应中断: ${fallbackMessage}`;
}

/**
 * 工具执行异常 → 用户友好提示（过滤 OpenAI SDK/fetch 级技术错误，不暴露实现细节）
 */
export function getToolExecErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) {
    return `工具执行异常: ${String(err).slice(0, 200)}`;
  }
  const msg = err.message;
  const lower = msg.toLowerCase();

  // ── 服务商过载/不可用 ──
  if (
    lower.includes('503') ||
    lower.includes('overloaded') ||
    lower.includes('too busy') ||
    lower.includes('server error') ||
    lower.includes('service unavailable') ||
    lower.includes('capacity')
  ) {
    let detail = '';
    try {
      const jsonMatch = msg.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const body = JSON.parse(jsonMatch[0]);
        if (body.code) detail = ` (${body.code})`;
        if (body.message) detail = ` (${body.code || ''}: ${body.message})`;
      }
    } catch {
      /* ignore */
    }
    return `AI 服务繁忙，请稍后重试${detail}`;
  }

  // ── 频率限制 ──
  if (
    lower.includes('429') ||
    lower.includes('rate limit') ||
    lower.includes('too many requests')
  ) {
    return '请求过于频繁，请稍后重试';
  }

  // ── 认证/权限 ──
  if (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('unauthorized') ||
    lower.includes('invalid api key')
  ) {
    return 'AI 服务认证失败，请检查模型配置中的 API Key';
  }

  // ── 上下文溢出 ──
  if (
    lower.includes('context length') ||
    lower.includes('too long') ||
    lower.includes('maximum context') ||
    lower.includes('token limit')
  ) {
    return '输入内容过长，请缩短输入或开启会话压缩';
  }

  // ── 超时 ──
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'AI 服务响应超时，请稍后重试';
  }

  // ── mutex 死锁 ──
  if (lower.includes('simplemutex') || lower.includes('acquire timeout')) {
    return '会话正在处理中，请等待上一条消息完成后重试';
  }

  // socket 连接意外关闭 → AI 服务响应中断
  if (msg.includes('socket connection was closed')) {
    return 'AI 服务响应中断，请重试';
  }
  // fetch 超时 / 网络错误（判据收敛到 `isNetworkUnavailableError`，与模型请求面同源）
  if (isNetworkUnavailableError(err)) {
    return '连接 AI 服务失败，请检查网络后重试';
  }

  return `工具执行异常: ${msg.slice(0, 200)}`;
}
