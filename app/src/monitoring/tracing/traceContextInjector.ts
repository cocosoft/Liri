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
 * W3C TraceContext 注入工具（`traceContextExtractor` 的出站对称面）
 *
 * 出站调用（MCP HTTP/SSE 等）把**当前活动 span** 的 `traceparent` 带进请求头，
 * 服务端用同一 W3C 格式恢复上下文 ⇒ trace 不再断在进程边界
 * （基础设施专项 §6-#6）。
 *
 * 为什么手工拼而不是 `propagation.inject`：全局 propagator 由 SDK 注册，
 * 未注册时为 noop（注入静默失败）。手工按 W3C 格式构造，不依赖
 * 全局注册顺序，且可被单测直接覆盖。
 */

import {
  context,
  trace,
  type Span,
  type SpanContext,
} from '@opentelemetry/api';

/** W3C traceparent 请求头名 */
export const TRACEPARENT_HEADER = 'traceparent';

const TRACE_ID_RE = /^[0-9a-f]{32}$/;
const SPAN_ID_RE = /^[0-9a-f]{16}$/;
const ZERO_TRACE_ID = '0'.repeat(32);
const ZERO_SPAN_ID = '0'.repeat(16);

/**
 * 按 W3C Trace Context 构造 `traceparent`。
 *
 * 全零 / 长度不符的 id 不合法（W3C §3.2.2.3）⇒ 返回 `undefined`，
 * 由调用方**不带**该头（而不是发出一个坏头）。
 */
export function buildTraceparent(
  spanContext:
    | Pick<SpanContext, 'traceId' | 'spanId' | 'traceFlags'>
    | undefined
): string | undefined {
  if (!spanContext) return undefined;
  const { traceId, spanId, traceFlags } = spanContext;
  if (!TRACE_ID_RE.test(traceId) || traceId === ZERO_TRACE_ID) return undefined;
  if (!SPAN_ID_RE.test(spanId) || spanId === ZERO_SPAN_ID) return undefined;
  const flags = (traceFlags & 0xff).toString(16).padStart(2, '0');
  return `00-${traceId}-${spanId}-${flags}`;
}

/** 取当前活动 span 的 `traceparent`；无活动 span ⇒ `undefined` */
export function currentTraceparent(): string | undefined {
  return buildTraceparent(trace.getSpanContext(context.active()));
}

/**
 * 返回带 `traceparent` 的请求头副本。
 *
 * - 无活动 span ⇒ **原样返回**入参（不制造额外对象，也不发坏头）；
 * - 调用方已显式提供 `traceparent`（任意大小写）⇒ **尊重调用方**，不覆盖。
 */
export function withTraceparentHeaders(
  headers: Record<string, string> = {}
): Record<string, string> {
  const existing = Object.keys(headers).some(
    (key) => key.toLowerCase() === TRACEPARENT_HEADER
  );
  if (existing) return headers;
  const traceparent = currentTraceparent();
  if (!traceparent) return headers;
  return { ...headers, [TRACEPARENT_HEADER]: traceparent };
}

/**
 * 在「`span` 为活动 span」的上下文中执行回调（含其 `await` 链）。
 *
 * `tracer.startSpan()` 只创建 span、**不激活**它；要让下游（MCP 出站等）
 * 取到父上下文，必须显式把它放进 `context`。依赖
 * `bootstrapTelemetry()` 已注册的 AsyncLocalStorage ContextManager。
 */
export function runWithActiveSpan<T>(span: Span, fn: () => T): T {
  return context.with(trace.setSpan(context.active(), span), fn);
}
