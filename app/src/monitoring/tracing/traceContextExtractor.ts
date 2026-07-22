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
 * P1-2.16: W3C TraceContext 提取工具
 *
 * 从前端 WebSocket/SSE 连接请求的 query string 中提取 traceparent，
 * 通过 OTel propagation API 恢复 Span 上下文，实现跨进程追踪。
 */

import type { IncomingMessage } from 'http';
import {
  propagation,
  context,
  ROOT_CONTEXT,
  type Context,
} from '@opentelemetry/api';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'monitoring:tracing:extract',
  level: LogLevel.DEBUG,
});

/**
 * 从 HTTP 请求的 URL query string 中提取 traceparent 并恢复 OTel 上下文
 *
 * @param req HTTP 请求对象
 * @returns 提取后的 OTel Context，若未携带 traceparent 则返回 ROOT_CONTEXT
 */
export function extractTraceContextFromRequest(req: IncomingMessage): Context {
  try {
    const url = req.url;
    if (!url) return ROOT_CONTEXT;

    // 解析 URL query string
    const queryIndex = url.indexOf('?');
    if (queryIndex === -1) return ROOT_CONTEXT;

    const queryString = url.substring(queryIndex + 1);
    const params = new URLSearchParams(queryString);
    const traceparent = params.get('traceparent');

    if (!traceparent) return ROOT_CONTEXT;

    // 通过 OTel propagation API 提取上下文
    const extracted = propagation.extract(ROOT_CONTEXT, { traceparent });
    return extracted;
  } catch (err) {
    logger.debug('traceparent 提取失败', { error: String(err) });
    return ROOT_CONTEXT;
  }
}

/**
 * 在提取的 OTel 上下文中执行回调并返回结果
 *
 * @param req HTTP 请求对象
 * @param fn 要在上下文中执行的回调
 * @returns 回调的返回值
 */
export function withTraceContextFromRequestResult<T>(
  req: IncomingMessage,
  fn: () => T
): T {
  const ctx = extractTraceContextFromRequest(req);
  let result: T;
  context.with(ctx, () => {
    result = fn();
  });
  return result!;
}

/**
 * 在提取的 OTel 上下文中执行回调（无返回值版本）
 *
 * 用法：
 *   withTraceContextFromRequest(req, () => {
 *     // 此处注册的 async 事件回调将继承该上下文
 *     socket.on('data', handler);
 *   });
 *
 * @param req HTTP 请求对象
 * @param fn 要在上下文中执行的回调
 */
export function withTraceContextFromRequest(
  req: IncomingMessage,
  fn: () => void
): void {
  const ctx = extractTraceContextFromRequest(req);
  context.with(ctx, fn);
}
