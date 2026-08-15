/**
 * Fetch 拦截器
 *
 * 包装全局 fetch，自动捕获 AI API 流量。
 * 使用 monkey-patch 模式（同 OpenTelemetry 自动埋点），
 * 对 Provider 层完全透明。
 *
 * 安装后所有 AI API 调用会被自动录制，业务代码零改动。
 */

import { isAIApiUrl, sanitizeHeaders } from './URLMatcher';
import { SSEReassembler } from '../sse/SSEReassembler';
import { TraceEngine } from '../engine/TraceEngine';
import type { TraceRecord, SSERawEvent } from '../types';
import { extractModelName } from './URLMatcher';
import crypto from 'crypto';

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = getLogger('trace-recording:interceptor:FetchInterceptor');

/** 拦截器回调 - 当有流量被录制时触发 */
export type InterceptorCallback = (record: TraceRecord) => void | Promise<void>;

/** 拦截事件类型 */
export interface InterceptedEvent {
  /** 请求URL */
  url: string;
  /** 请求方法 */
  method: string;
  /** 请求头 */
  headers: Record<string, string>;
  /** 请求体 */
  body: unknown;
  /** 请求体原始文本 */
  bodyText: string;
  /** 是否流式请求 */
  isStreaming: boolean;
}

/**
 * Fetch 拦截器
 */
export class FetchInterceptor {
  private originalFetch: typeof globalThis.fetch | null = null;
  private engine: TraceEngine | null = null;
  private callback: InterceptorCallback | null = null;
  private installed = false;
  private turnCounter = 0;

  /**
   * 安装拦截器
   * 替换全局 fetch 为包装版本
   * @param engine 录制引擎
   * @param callback 录制回调
   */
  install(engine: TraceEngine, callback: InterceptorCallback): void {
    if (this.installed) {
      return;
    }

    this.originalFetch = globalThis.fetch.bind(globalThis);
    this.engine = engine;
    this.callback = callback;
    this.installed = true;
    this.turnCounter = 0;

    const self = this;
    const original = this.originalFetch;

    globalThis.fetch = function interceptedFetch(
      input: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> {
      return self.intercept(input, init, original);
    };

    globalThis.fetch.toString = () => original.toString();
  }

  /**
   * 卸载拦截器
   * 恢复原始的全局 fetch
   */
  uninstall(): void {
    if (!this.installed || !this.originalFetch) {
      return;
    }

    globalThis.fetch = this.originalFetch;
    this.originalFetch = null;
    this.engine = null;
    this.callback = null;
    this.installed = false;
  }

  /**
   * 是否已安装
   */
  get isInstalled(): boolean {
    return this.installed;
  }

  /**
   * 异步触发录制回调（fire-and-forget）。
   * 修复（2026-08-15）：此前直接 `this.callback(record)` 未 await 且未捕获
   * rejection —— 大记录写入 TraceWriter 失败会静默丢失并产生 unhandledRejection。
   * 这里保持不阻塞响应，但对 rejection 统一记录日志。
   */
  private emitRecord(record: TraceRecord): void {
    if (!this.callback) return;
    const result = this.callback(record);
    if (result && typeof (result as Promise<void>).catch === 'function') {
      (result as Promise<void>).catch((err) => {
        logger.warn('trace:fetchInterceptor callback 失败', {
          recordId: record.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  /**
   * 拦截逻辑
   * @param input fetch 输入
   * @param init fetch 配置
   * @param original 原始 fetch 函数
   * @returns Response
   */
  private async intercept(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    original: typeof globalThis.fetch
  ): Promise<Response> {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const method = (
      init?.method ||
      (typeof input === 'object' && 'method' in input
        ? (input as Request).method
        : 'GET') ||
      'GET'
    ).toUpperCase();

    const isAI = isAIApiUrl(url);
    if (!isAI) {
      return original(input, init);
    }

    this.turnCounter++;
    const t0 = performance.now();
    // P2 修复（2026-08-15）：记录请求发起时刻（绝对时间戳）。
    // 此前 timestamp 在响应完成后写入（完成时刻）——长流（如 34s 的 Kimi）
    // 记录的时间戳会严重滞后于真实发起时间，误导时间线分析（对话 L2069）。
    const startedAtMs = Date.now();
    const reqId = `req_${crypto.randomBytes(6).toString('hex')}`;

    let reqBodyText = '';
    let reqBody: unknown = undefined;
    let isStreaming = false;

    try {
      if (init?.body) {
        reqBodyText =
          typeof init.body === 'string' ? init.body : String(init.body);
        try {
          reqBody = JSON.parse(reqBodyText);
          if (
            reqBody &&
            typeof reqBody === 'object' &&
            'stream' in (reqBody as Record<string, unknown>)
          ) {
            isStreaming = !!(reqBody as Record<string, unknown>).stream;
          }
        } catch {
          reqBody = reqBodyText;
        }
      } else if (typeof input === 'object' && 'body' in input) {
        const r = input as Request;
        if (r.body) {
          reqBodyText = await r.clone().text();
          try {
            reqBody = JSON.parse(reqBodyText);
            if (
              reqBody &&
              typeof reqBody === 'object' &&
              'stream' in (reqBody as Record<string, unknown>)
            ) {
              isStreaming = !!(reqBody as Record<string, unknown>).stream;
            }
          } catch {
            reqBody = reqBodyText;
          }
        }
      }
    } catch (err) {
      // body 读取失败时不录制

      handleError(err, {
        module: 'trace-recording:interceptor',
        action: 'readBody',
      });
    }

    // 构建请求头
    const reqHeaders: Record<string, string> = {};
    try {
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((v, k) => {
            reqHeaders[k] = v;
          });
        } else if (Array.isArray(init.headers)) {
          for (const [k, v] of init.headers) {
            reqHeaders[k] = v;
          }
        } else {
          Object.assign(reqHeaders, init.headers as Record<string, string>);
        }
      } else if (typeof input === 'object' && 'headers' in input) {
        (input as Request).headers.forEach((v, k) => {
          reqHeaders[k] = v;
        });
      }
    } catch (err) {
      // 头读取失败

      handleError(err, {
        module: 'trace-recording:interceptor',
        action: 'readHeaders',
      });
    }

    // v5 方案 3.2：流式请求两阶段写入——请求发起时先落 pending 记录
    // （不经过 shouldRecord，保证"发起过"可复盘；非流式保持现状单写）
    let streamError: string | undefined;
    if (isStreaming && this.engine && this.callback) {
      this.emitRecord(
        this.buildRecord(
          reqId,
          startedAtMs,
          method,
          url,
          reqHeaders,
          reqBody,
          reqBodyText,
          0,
          {},
          null,
          0,
          undefined,
          extractModelName(reqBody || {}),
          undefined,
          'pending'
        )
      );
    }

    try {
      const response = await original(input, init);
      const durationMs = Math.round(performance.now() - t0);

      if (!this.engine || !this.callback) {
        return response;
      }

      // 构建响应头
      const respHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        respHeaders[k] = v;
      });

      // 判断Content-Type是否为SSE
      const contentType = response.headers.get('content-type') || '';
      const isSSE = contentType.includes('text/event-stream') || isStreaming;

      let respBody: unknown = undefined;
      let sseEvents: SSERawEvent[] | undefined;

      if (isSSE && response.body) {
        // 流式响应：克隆 response，读取克隆体进行 SSE 解析
        const clonedResponse = response.clone();
        const reassembler = new SSEReassembler();

        try {
          const clonedBody = clonedResponse.body;
          if (!clonedBody) {
            return response;
          }
          const reader = clonedBody.getReader();
          const decoder = new TextDecoder();
          let done = false;

          while (!done) {
            const result = await reader.read();
            done = result.done;
            if (result.value) {
              const text = decoder.decode(result.value, { stream: !done });
              reassembler.feedBytes(new TextEncoder().encode(text));
            }
          }
        } catch (err) {
          // 流读取异常时使用已有数据，不中断主响应
          // v5 方案 3.2：保存错误到 streamError，completed 记录带 error 字段
          streamError = err instanceof Error ? err.message : String(err);
          logger.warn('trace:fetchInterceptor SSE reader error', {
            error: streamError,
            url,
          });
        }

        sseEvents = reassembler.getEvents();
        respBody = reassembler.reconstruct();

        // 检查当前录制模式是否应该录制
        if (!this.shouldRecord(durationMs, sseEvents)) {
          return response;
        }

        // 异步写入录制记录（不阻塞响应）
        const record = this.buildRecord(
          reqId,
          startedAtMs,
          method,
          url,
          reqHeaders,
          reqBody,
          reqBodyText,
          response.status,
          respHeaders,
          respBody,
          durationMs,
          sseEvents,
          extractModelName(reqBody || {}),
          streamError
        );

        this.emitRecord(record);
      } else {
        // 非流式响应：先克隆再读body
        if (response.body) {
          const clonedResponse = response.clone();
          try {
            const text = await clonedResponse.text();
            try {
              respBody = JSON.parse(text);
            } catch {
              respBody = text;
            }
          } catch (err) {
            // body 解析失败

            handleError(err, {
              module: 'trace-recording:interceptor',
              action: 'readResponseBody',
            });
          }
        }

        if (!this.shouldRecord(durationMs, undefined, response.status)) {
          return response;
        }

        const record = this.buildRecord(
          reqId,
          startedAtMs,
          method,
          url,
          reqHeaders,
          reqBody,
          reqBodyText,
          response.status,
          respHeaders,
          respBody,
          durationMs,
          undefined,
          extractModelName(reqBody || {})
        );

        this.emitRecord(record);
      }

      return response;
    } catch (error) {
      // 如果录制过程错误，仍返回原始结果
      const durationMs = Math.round(performance.now() - t0);
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (this.engine && this.callback) {
        const record = this.buildRecord(
          reqId,
          startedAtMs,
          method,
          url,
          reqHeaders,
          reqBody,
          reqBodyText,
          0,
          {},
          undefined,
          durationMs,
          undefined,
          extractModelName(reqBody || {}),
          errorMessage
        );
        this.emitRecord(record);
      }

      throw error;
    }
  }

  /**
   * 判断是否应该录制
   * @param durationMs 耗时
   * @param sseEvents SSE事件（可选）
   * @param status HTTP状态码（可选）
   * @returns 是否录制
   */
  private shouldRecord(
    durationMs: number,
    sseEvents?: SSERawEvent[],
    status?: number
  ): boolean {
    if (!this.engine) {
      return false;
    }
    const mode = this.engine.getMode();
    if (mode === 'all') {
      return true;
    }
    if (mode === 'error-only') {
      if (status && status >= 400) {
        return true;
      }
      if (sseEvents) {
        for (const ev of sseEvents) {
          if (ev.event === 'error' || ev.event.endsWith('_error')) {
            return true;
          }
        }
      }
      return false;
    }
    if (mode === 'slow-only') {
      const threshold = this.engine.getSlowThreshold();
      return durationMs >= threshold;
    }
    return true;
  }

  /**
   * 构建录制记录
   * @param startedAtMs 请求发起时刻（绝对时间戳，P2 修复：长流时间线不再滞后）
   * @param phase 记录阶段：'pending'（请求发起）| 'completed'（默认，完成/中断）
   */
  private buildRecord(
    reqId: string,
    startedAtMs: number,
    method: string,
    url: string,
    reqHeaders: Record<string, string>,
    reqBody: unknown,
    reqBodyText: string,
    status: number,
    respHeaders: Record<string, string>,
    respBody: unknown,
    durationMs: number,
    sseEvents?: SSERawEvent[],
    model?: string,
    error?: string,
    phase: 'pending' | 'completed' = 'completed'
  ): TraceRecord {
    const record: TraceRecord = {
      id: reqId,
      timestamp: new Date(startedAtMs).toISOString(),
      turn: this.turnCounter,
      durationMs,
      upstreamBaseUrl: url,
      phase,
      request: {
        method,
        path: url,
        headers: sanitizeHeaders(reqHeaders),
        body: reqBody || reqBodyText,
      },
      response: {
        status,
        headers: sanitizeHeaders(respHeaders),
        body: respBody || null,
      },
    };

    if (sseEvents && sseEvents.length > 0) {
      record.response.sseEvents = sseEvents;
    }

    if (error) {
      record.error = error;
    }

    // v5 方案 3.1：completed 记录带完成时刻
    if (phase === 'completed') {
      record.completedAt = new Date().toISOString();
    }

    return record;
  }
}
