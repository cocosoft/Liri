/**
 * 出站请求统一入口（2026-11-03）
 *
 * 背景（根因）：本仓所有"出站"调用（搜索、抓网页、以及未来的外部 API）此前都是
 * **裸调 `fetch()`**。而 `fetch` 只认 `HTTP(S)_PROXY` / `ALL_PROXY` 环境变量，
 * **不继承 Windows 系统代理**（`Internet Settings` 注册表）——用户明明开着可用代理，
 * 工具却走直连，表现为 `ECONNREFUSED` 或按出口 IP返回的区域化结果。
 *
 * 本模块把"代理从哪来 + 失败如何表达"收敛为**一处**：
 * - 代理：统一走 `resolveProxyForUrl()`（env > 系统代理 > 直连，回环与 NO_PROXY 绕过）；
 * - 失败：抛 `OutboundTransportError`（携带 URL / 代理来源 / 底层 code），
 *   让调用方能区分「通道不可达」与「成功但 0 结果」——这正是此前被反复误读的一层。
 */

import { getLogger } from '@openliri/kernel/loggerFacade';
import { AppError, ErrorCategory, ErrorSeverity } from '@openliri/infra/error';
import {
  resolveProxyForUrl,
  resolveProxyWithoutBypass,
  type ProxyResolution,
  type ProxySource,
} from './proxy.js';

const logger = getLogger('utils:outboundFetch');

type FetchInitWithProxy = RequestInit & { proxy?: string };

/** 出站传输层失败（DNS / 连接 / 代理握手 / TLS 等），**不含 HTTP 4xx/5xx** */
export class OutboundTransportError extends AppError {
  readonly url: string;
  readonly proxy: ProxyResolution;
  /** 底层传输 code（ECONNREFUSED / ENOTFOUND / ConnectionRefused …） */
  readonly transportCode?: string;

  constructor(url: string, proxy: ProxyResolution, cause: unknown) {
    const transportCode = extractErrorCode(cause);
    super(
      `${transportCode ?? 'TRANSPORT_FAILURE'}（${describeProxyLabel(proxy)}）`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.MEDIUM,
      'OUTBOUND_TRANSPORT_ERROR',
      { url, proxySource: proxy.source, proxyBypassed: proxy.bypassed }
    );
    this.name = 'OutboundTransportError';
    this.url = url;
    this.proxy = proxy;
    this.transportCode = transportCode;
    this.cause = cause;
  }
}

function extractErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === 'object' && cause !== null) {
    const nested = (cause as { code?: unknown }).code;
    if (typeof nested === 'string') return nested;
  }
  return undefined;
}

/** 人类可读的代理标签（诊断文案用） */
export function describeProxyLabel(resolution: ProxyResolution): string {
  if (resolution.bypassed) {
    return `直连（绕过规则 ${resolution.bypassRule ?? 'NO_PROXY'}）`;
  }
  if (!resolution.proxyUrl) return '直连';
  return `${resolution.source} 代理 ${redactProxyUrl(resolution.proxyUrl)}`;
}

/** 代理 URL 可能含凭证，日志/工具结果里只保留协议 + 主机 + 端口 */
export function redactProxyUrl(proxyUrl: string): string {
  try {
    const parsed = new URL(proxyUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return 'invalid-proxy-url';
  }
}

function isBunRuntime(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';
}

/**
 * 统一出站 fetch。
 *
 * - Bun：经 `fetch(url, { proxy })` 显式指定（不依赖环境变量是否被外部注入）；
 * - Node：不做逐请求代理（`RequestInit` 无该字段），依赖 `HTTP(S)_PROXY` /
 *   `NODE_USE_ENV_PROXY=1`；此处只在解析到系统代理时记一条 debug，便于定位。
 */
export async function outboundFetch(
  url: string,
  init: RequestInit = {}
): Promise<Response> {
  const resolution = resolveProxyForUrl(url);
  const merged: FetchInitWithProxy = { ...init };

  if (resolution.proxyUrl && !resolution.bypassed) {
    if (isBunRuntime()) {
      merged.proxy = resolution.proxyUrl;
    } else {
      logger.debug('出站代理需由环境变量生效（Node 运行时）', {
        url,
        proxy: redactProxyUrl(resolution.proxyUrl),
        source: resolution.source,
      });
    }
  }

  try {
    return await fetch(url, merged as RequestInit);
  } catch (error) {
    // 超时 / 用户取消不是"通道不可达"：原样抛出，由调用方按 AbortError 处理
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new OutboundTransportError(url, resolution, error);
  }
}

/**
 * 把出站失败翻成**面向模型的明确文案**：区分「通道不可达」与「没有相关内容」。
 * 非出站错误原样透传，由调用方决定措辞。
 */
export function describeOutboundFailure(error: unknown): string | null {
  if (!(error instanceof OutboundTransportError)) return null;
  return `网络通道不可达（${error.transportCode ?? '传输失败'}；${describeProxyLabel(error.proxy)}）。这是通道问题，不代表"没有相关内容"；请检查代理/网络后重试。`;
}

/** 当前出站代理来源（诊断/doctor 用；不传 URL 时只看"有没有代理、来自哪"） */
export function getOutboundProxySource(url?: string): {
  source: ProxySource;
  proxyUrl?: string;
} {
  if (!url) return resolveProxyWithoutBypass();
  const resolution = resolveProxyForUrl(url);
  return { source: resolution.source, proxyUrl: resolution.proxyUrl };
}
