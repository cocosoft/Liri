/**
 * 渠道链路错误分类（2026-10-19）
 *
 * 两类消费者共用本文件，避免各写一套字符串匹配：
 * 1. **出站重试策略**（N10）：区分「请求尚未发出」与「可能已送达但结果不确定」，
 *    后者禁止自动重试，防止同一条消息发两遍。
 * 2. **入站路由异常观测**（N9）：为最终 catch 补一个稳定分类维度，仅用于日志/遥测，
 *    **不改变控制流**（N9 是否细分仍由稳定性证据决定）。
 */

// ─── 出站：重试安全性 ─────────────────────────────────

export type OutboundErrorKind = 'pre_send' | 'ambiguous' | 'unknown';

export interface OutboundErrorClassification {
  kind: OutboundErrorKind;
  /** Node/Undici 错误码（存在时带出，便于日志检索） */
  code?: string;
  /** 是否允许自动重试（`ambiguous` 为 false） */
  retryable: boolean;
}

/** 连接尚未建立即失败 ⇒ 一定未送达 */
const PRE_SEND_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'ERR_INVALID_URL',
]);

/** 请求可能已发出 ⇒ 结果不确定，禁止自动重试 */
const AMBIGUOUS_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNABORTED',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

function readCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function readName(err: unknown): string {
  if (typeof err !== 'object' || err === null) return '';
  const name = (err as { name?: unknown }).name;
  return typeof name === 'string' ? name : '';
}

/**
 * 分类出站错误（纯函数，供重试策略与日志共用）。
 *
 * `unknown` 保留「可重试」语义：通道自定义的临时错误不应因无法归类而误伤；
 * 只有**明确不确定**的超时/重置类错误才禁止重试。
 */
export function classifyOutboundError(
  err: unknown
): OutboundErrorClassification {
  const code = readCode(err);
  if (code && PRE_SEND_CODES.has(code)) {
    return { kind: 'pre_send', code, retryable: true };
  }
  if (code && AMBIGUOUS_CODES.has(code)) {
    return { kind: 'ambiguous', code, retryable: false };
  }

  const name = readName(err);
  if (name === 'TimeoutError' || name === 'AbortError') {
    return { kind: 'ambiguous', code, retryable: false };
  }

  return { kind: 'unknown', code, retryable: true };
}

// ─── 入站：异常观测分类（不改控制流）─────────────────

export type RouterErrorKind =
  | 'aborted'
  | 'timeout'
  | 'network'
  | 'protocol'
  | 'unknown';

export interface RouterErrorClassification {
  kind: RouterErrorKind;
  code?: string;
}

const NETWORK_CODES = new Set([
  ...PRE_SEND_CODES,
  ...AMBIGUOUS_CODES,
  'UND_ERR_CONNECT_TIMEOUT',
]);

const PROTOCOL_CODES = new Set([
  'ERR_INVALID_ARG_TYPE',
  'ERR_INVALID_ARG_VALUE',
  'ERR_INVALID_RETURN_VALUE',
  'ERR_STREAM_PREMATURE_CLOSE',
  'Z_DATA_ERROR',
]);

/** 分类入站路由异常（纯函数；仅用于日志/遥测，不参与控制流） */
export function classifyRouterError(err: unknown): RouterErrorClassification {
  const name = readName(err);
  const code = readCode(err);

  if (name === 'AbortError') return { kind: 'aborted', code };
  if (name === 'TimeoutError' || code === 'ETIMEDOUT') {
    return { kind: 'timeout', code };
  }
  if (code && NETWORK_CODES.has(code)) return { kind: 'network', code };
  if (code && PROTOCOL_CODES.has(code)) return { kind: 'protocol', code };

  return { kind: 'unknown', code };
}
