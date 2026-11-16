// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * openaiStreamFailure.ts — OpenAI 兼容流式请求的 **失败分类 / 首块前重试判据**
 * （2026-11-17，P3-2 复杂度外移）
 *
 * 从 `OpenAIProvider.chatStreamInternal` 的 catch 段逐字外移：`describeFetchError` 连同其
 * `FetchCause` 形状整体搬迁（此前仅该 catch 调用它），失败分类与「可重试」判据改为纯函数。
 * **判定顺序、正则、注释语义一字未改**。等价性由
 * `tests/ai/providers/openaiStreamAccumulation.test.ts`（外移前先写的端到端特征化用例）锁定；
 * 分类细节由 `tests/ai/providers/openaiStreamFailure.test.ts` 逐条钉住。
 */

import { BaseAIProvider } from './BaseAIProvider';

/**
 * 提取 fetch 底层连接错误的 cause（undici/Bun 将 DNS/连接错误包装为
 * 通用 TypeError/Error 消息，真实原因在 cause 或错误自身的 code 中：
 * code=ENOTFOUND/ECONNREFUSED/EAI_AGAIN/ETIMEDOUT/ConnectionRefused 等）。
 * 实现在 BaseAIProvider.extractFetchCause（兼容 undici + Bun 两种结构），
 * 此处仅定义类型供 describeFetchError 使用，避免双份实现（CS01 归一化）。
 */
export interface FetchCause {
  code: string;
  hostname: string;
  port: number;
}

/**
 * 将 fetch cause 映射为可执行的中文诊断提示（附 host/port）。
 * 兼容 undici（ENOTFOUND/ECONNREFUSED...）与 Bun（ConnectionRefused，无 hostname/port）。
 */
export function describeFetchError(cause: FetchCause, url: string): string {
  const host =
    cause.hostname ||
    (() => {
      try {
        return new URL(url).host;
      } catch {
        return url;
      }
    })();
  const port = cause.port ? `:${cause.port}` : '';

  switch (cause.code) {
    case 'ENOTFOUND':
      return `DNS 解析失败（${host}${port} 无法解析）。请检查：
1. 域名/地址拼写是否正确（当前: ${host}）
2. 本机网络能否访问该地址（是否需要代理）
3. 本机 DNS 是否正常`;
    case 'EAI_AGAIN':
      return `DNS 临时解析失败（${host}${port}），网络可能波动，请稍后重试`;
    case 'ECONNREFUSED':
      return `连接被拒绝（${host}${port}）。请检查：
1. 端口是否正确（当前: ${port || '(默认端口)'}）
2. 目标服务是否在运行
3. 是否有防火墙/代理拦截`;
    case 'ConnectionRefused':
      // Bun 将 DNS 解析失败/连接被拒绝/TCP 重置统一归为此错误码，且不附 hostname/port
      return `连接失败（${host}${port}）。Bun 将 DNS 解析失败、连接被拒绝与 TCP 重置统一归为此类，请检查：
1. 域名/地址是否可访问（当前: ${host}${port}）
2. 本机网络/代理是否正常
3. 目标服务是否在运行、端口是否正确（当前连接地址: ${host}${port || '(默认端口)'}）`;
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
      return `连接超时（${host}${port}）。请检查网络连通性或代理配置`;
    default:
      return `网络连接失败（${host}${port}, ${cause.code}）`;
  }
}

/** 流失败分类结果（供日志、重试判据与用户提示共用） */
export type StreamFailureClassification = {
  errorMessage: string;
  diagnostic: string;
  isSocketClosed: boolean;
  isTimeout: boolean;
  isSSLError: boolean;
  /** SSL 错误详细诊断（仅 SSL 类失败携带） */
  sslDetail?: {
    certPath: string | null;
    certLoaded: boolean;
    runtime: string;
    elapsedMs: number;
    errorName: string;
  };
};

/**
 * 对一次流式请求失败做分类（纯函数，不写日志、不改状态）。
 *
 * @param error        捕获到的异常
 * @param fetchCause   调用方经 `BaseAIProvider.extractFetchCause()` 提取的底层连接原因
 * @param endpointUrl  实际请求的 `/chat/completions` 端点（用于诊断文案）
 * @param streamStartMs 请求发起时刻（用于 SSL 诊断的 `elapsedMs`）
 */
export function classifyStreamFailure(
  error: unknown,
  {
    fetchCause,
    endpointUrl,
    streamStartMs,
  }: {
    fetchCause: FetchCause | null;
    endpointUrl: string;
    streamStartMs: number;
  }
): StreamFailureClassification {
  const errorMessage = (error as Error).message || String(error);
  // 提取 fetch 底层 cause（ENOTFOUND/ECONNREFUSED/EAI_AGAIN/ConnectionRefused 等）：
  // undici/Bun 只给 "Was there a typo..." / "Unable to connect..." 通用消息，
  // 真实原因（DNS/端口/超时）藏在 TypeError.cause 或错误自身 code 里，需展开为可执行提示。
  const diagnostic = fetchCause
    ? describeFetchError(fetchCause, endpointUrl)
    : errorMessage;
  // socket 被对端关闭且尚未产出内容：重试整个请求（attempt 0 → 1）
  const isSocketClosed =
    /socket.*(closed|reset)|connection.*(closed|reset)/i.test(errorMessage);
  // 超时检测：AbortSignal.timeout 触发的 DOMException（TimeoutError / "The operation timed out."）
  // 或底层 ETIMEDOUT。发生在响应头/首块到达前（fullContent 为空）时，视为 Provider 瞬时故障
  // （如智谱偶发请求挂起无响应头，重发通常立即成功），与连接中断同策略重试一次。
  const isTimeout =
    (error instanceof DOMException && error.name === 'TimeoutError') ||
    /timed out|timeout|ETIMEDOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT/i.test(
      errorMessage
    );
  // SSL/TLS 证书错误检测（2026-08-24 增强）：CDN 边缘节点可能瞬态返回
  // 不完整证书链（Bun BoringSSL 报 unknown certificate verification error），
  // 该错误同样发生在响应头到达前（fullContent 为空），重发通常立即成功，
  // 与连接中断/超时同策略重试一次（实测 DeepSeek 偶发 SSL 验证失败可重试恢复）。
  const isSSLError = /certificate|ssl|tls|unable to verify/i.test(errorMessage);
  // SSL 错误详细诊断（2026-08-24）：记录 CA 注入状态、运行时与耗时，
  // 便于复现排查 CDN 瞬态证书链问题（unknown certificate verification error）
  const sslDetail = isSSLError
    ? {
        ...BaseAIProvider.getCaCertDiagnostic(),
        runtime: typeof Bun === 'undefined' ? 'node' : 'bun',
        elapsedMs: Date.now() - streamStartMs,
        errorName: (error as Error)?.name ?? typeof error,
      }
    : undefined;

  return {
    errorMessage,
    diagnostic,
    isSocketClosed,
    isTimeout,
    isSSLError,
    ...(sslDetail ? { sslDetail } : {}),
  };
}

/**
 * 首块前失败是否值得重试一次。
 *
 * 判据（逐字沿用内联版）：仍有重试额度 ∧ 属连接中断 / 超时 / SSL 瞬态故障 ∧
 * **尚未产出任何内容**（LLM 无状态，重发安全；已产出内容时重试会重复输出）。
 */
export function shouldRetryStreamFailure(
  classification: Pick<
    StreamFailureClassification,
    'isSocketClosed' | 'isTimeout' | 'isSSLError'
  >,
  attempt: number,
  maxAttempts: number,
  producedLength: number
): boolean {
  return (
    attempt < maxAttempts - 1 &&
    (classification.isSocketClosed ||
      classification.isTimeout ||
      classification.isSSLError) &&
    producedLength === 0
  );
}
