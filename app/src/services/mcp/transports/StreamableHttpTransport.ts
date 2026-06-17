// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * MCP Streamable HTTP 传输 (2025-03-26 规范)
 *
 * POST-only 传输，支持 SSE 流式响应和会话管理。
 * 与现有 HTTPTransport（简单请求/响应）互补，符合 MCP 最新规范。
 *
 *
 * 规范要点:
 *   - POST 请求发送 JSON-RPC 消息
 *   - 响应可以是 application/json 或 text/event-stream
 *   - 202 Accepted 表示通知/确认，无响应体
 *   - Mcp-Session-Id 头部管理会话
 *   - 404 + session header 表示会话过期
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const logger = new Logger({ level: LogLevel.INFO });

// ─── 类型 ────────────────────────────────────────────────────────────────────

/** JSON-RPC 消息 */
export interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/** 传输选项 */
export interface StreamableHttpTransportOptions {
  /** 端点 URL，如 https://mcp.example.com/mcp */
  url: string;
  /** 额外请求头（如 Authorization） */
  headers?: Record<string, string>;
  /** 请求超时（毫秒），默认 30_000 */
  timeoutMs?: number;
}

const SESSION_HEADER = 'mcp-session-id';
const DEFAULT_TIMEOUT_MS = 30_000;

// ─── 传输实现 ────────────────────────────────────────────────────────────────

export class StreamableHttpTransport {
  private readonly url: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly controller = new AbortController();
  private readonly queue: JsonRpcMessage[] = [];
  private readonly waiters: Array<(m: JsonRpcMessage | null) => void> = [];
  private readonly streams = new Set<Promise<void>>();
  private sessionId: string | null = null;
  private closed = false;

  constructor(opts: StreamableHttpTransportOptions) {
    this.url = opts.url;
    this.extraHeaders = opts.headers ?? {};
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // ── 发送请求 ──────────────────────────────────────────────────────────────

  /**
   * 发送 JSON-RPC 消息。
   * 响应通过 messages() 异步迭代器消费。
   */
  async send(message: JsonRpcMessage): Promise<void> {
    if (this.closed) {
      throw new AppError(
        'MCP Streamable HTTP transport is closed',
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...this.extraHeaders,
    };
    if (this.sessionId !== null) {
      headers[SESSION_HEADER] = this.sessionId;
    }

    let res: Response;
    try {
      const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
      const combinedSignal = AbortSignal.any([
        this.controller.signal,
        timeoutSignal,
      ]);

      res = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: combinedSignal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        throw new AppError(
          `MCP Streamable HTTP POST ${this.url} timed out after ${this.timeoutMs}ms`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }
      throw new AppError(
        `MCP Streamable HTTP POST ${this.url} failed: ${(err as Error).message}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 捕获服务器返回的 session id
    const serverSessionId = res.headers.get(SESSION_HEADER);
    if (serverSessionId && this.sessionId === null) {
      this.sessionId = serverSessionId;
      logger.info('Streamable HTTP session established', {
        sessionId: serverSessionId,
      });
    }

    // 404 + session header → 会话过期
    if (res.status === 404 && this.sessionId !== null) {
      await res.body?.cancel().catch(() => undefined);
      throw new AppError(
        `MCP Streamable HTTP session expired (server returned 404 with Mcp-Session-Id "${this.sessionId}"). Reinitialize the client.`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new AppError(
        `MCP Streamable HTTP POST ${this.url} → ${res.status} ${res.statusText}${body ? `: ${body}` : ''}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 202 Accepted → 通知/确认，无响应体
    if (res.status === 202) {
      await res.body?.cancel().catch(() => undefined);
      return;
    }

    const ct = (res.headers.get('content-type') ?? '').toLowerCase();

    // JSON 响应
    if (ct.includes('application/json')) {
      let parsed: unknown;
      try {
        parsed = await res.json();
      } catch (err) {
        throw new AppError(
          `MCP Streamable HTTP body wasn't valid JSON: ${(err as Error).message}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }
      if (Array.isArray(parsed)) {
        for (const item of parsed) this.pushMessage(item as JsonRpcMessage);
      } else {
        this.pushMessage(parsed as JsonRpcMessage);
      }
      return;
    }

    // SSE 流式响应
    if (ct.includes('text/event-stream')) {
      if (!res.body) {
        throw new AppError(
          'MCP Streamable HTTP SSE response had no body',
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1000'
        );
      }
      const stream = this.consumeSSEStream(res.body);
      this.streams.add(stream);
      stream.finally(() => this.streams.delete(stream));
      return;
    }

    // 未知内容类型 → 排空
    await res.body?.cancel().catch(() => undefined);
  }

  // ── 消息消费 ──────────────────────────────────────────────────────────────

  /**
   * 异步迭代接收到的消息
   */
  async *messages(): AsyncIterableIterator<JsonRpcMessage> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<JsonRpcMessage | null>((resolve) => {
        this.waiters.push(resolve);
      });
      if (next === null) return;
      yield next;
    }
  }

  // ── 生命周期 ──────────────────────────────────────────────────────────────

  /**
   * 关闭传输，清理所有资源
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // 唤醒所有等待者
    while (this.waiters.length > 0) {
      this.waiters.shift()!(null);
    }

    try {
      this.controller.abort();
    } catch {
      /* 已中止 */
    }

    // 等待所有 SSE 流完成
    await Promise.allSettled(Array.from(this.streams));
  }

  /**
   * 获取当前会话 ID（测试用）
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * 检查是否已关闭
   */
  isClosed(): boolean {
    return this.closed;
  }

  /**
   * 重置会话（清除 session ID）
   */
  resetSession(): void {
    this.sessionId = null;
  }

  // ── 内部 ──────────────────────────────────────────────────────────────────

  /**
   * 消费 SSE 流，将解析出的事件推入消息队列
   */
  private async consumeSSEStream(
    body: ReadableStream<Uint8Array>
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (this.closed) break;

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = extractSSEEvents(buffer);
        // 保留最后一个不完整的事件
        buffer = events.remainder;

        for (const ev of events.parsed) {
          if (ev.type === 'message' || ev.type === undefined) {
            try {
              const parsed = JSON.parse(ev.data) as JsonRpcMessage;
              this.pushMessage(parsed);
            } catch {
              /* 格式错误的 JSON — 丢弃 */
              logger.warn('Streamable HTTP: dropped malformed SSE event', {
                data: ev.data,
              });
            }
          }
          // 其他事件类型（ping, custom）静默忽略
        }
      }
    } catch (err) {
      if (!this.closed) {
        logger.error('Streamable HTTP SSE stream error', { err });
        this.pushMessage({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32000,
            message: `Streamable HTTP stream error: ${(err as Error).message}`,
          },
        });
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * 将消息推入队列或直接交给等待者
   */
  private pushMessage(msg: JsonRpcMessage): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(msg);
    } else {
      this.queue.push(msg);
    }
  }
}

// ─── SSE 解析 ────────────────────────────────────────────────────────────────

interface SSEEvent {
  type?: string;
  data: string;
}

interface SSEParseResult {
  parsed: SSEEvent[];
  remainder: string;
}

/**
 * 从文本缓冲区中提取完整的 SSE 事件
 *
 * SSE 格式：
 *   event: <type>\n
 *   data: <payload>\n
 *   \n
 */
function extractSSEEvents(buffer: string): SSEParseResult {
  const parsed: SSEEvent[] = [];
  let remainder = buffer;

  while (true) {
    const doubleNewline = remainder.indexOf('\n\n');
    if (doubleNewline === -1) break;

    const eventBlock = remainder.slice(0, doubleNewline);
    remainder = remainder.slice(doubleNewline + 2);

    const ev = parseSSEBlock(eventBlock);
    if (ev) parsed.push(ev);
  }

  return { parsed, remainder };
}

/**
 * 解析单个 SSE 事件块
 */
function parseSSEBlock(block: string): SSEEvent | null {
  let type: string | undefined;
  let data = '';

  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      type = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      const d = line.slice(5);
      // 去掉开头的空格（SSE 规范允许一个空格）
      data += (d.startsWith(' ') ? d.slice(1) : d) + '\n';
    }
    // 忽略注释行 (:) 和空行
  }

  if (!data) return null;

  // 去掉末尾的换行
  return { type, data: data.replace(/\n$/, '') };
}
