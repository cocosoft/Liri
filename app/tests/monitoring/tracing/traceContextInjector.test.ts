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
 * W3C `traceparent` 注入单测（基础设施专项 §6-#6）。
 *
 * 用 API 层的 `wrapSpanContext` 造「活动 span」，不依赖 SDK ⇒ 可在无 exporter
 * 的测试进程里断言出站头的精确形态。
 */
import { describe, expect, it } from 'bun:test';
import { context, trace, TraceFlags } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  TRACEPARENT_HEADER,
  buildTraceparent,
  currentTraceparent,
  runWithActiveSpan,
  withTraceparentHeaders,
} from '../../../src/monitoring/tracing/traceContextInjector';

// `@opentelemetry/api` 默认 ContextManager 是 noop（`context.with` 不生效），
// 与 `bootstrapTelemetry()` 注册的实现保持同一份契约。
const cm = new AsyncLocalStorageContextManager();
cm.enable();
context.setGlobalContextManager(cm);

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SPAN_ID = 'b7ad6b7169203331';

const spanContext = {
  traceId: TRACE_ID,
  spanId: SPAN_ID,
  traceFlags: TraceFlags.SAMPLED,
  isRemote: false,
};

/** 在「有活动 span」的上下文里执行 */
function withActiveSpan<T>(fn: () => T): T {
  return context.with(
    trace.setSpan(context.active(), trace.wrapSpanContext(spanContext)),
    fn
  );
}

describe('traceparent 构造（W3C Trace Context）', () => {
  it('合法 span 上下文 ⇒ 版本-追踪-跨度-标志', () => {
    expect(buildTraceparent(spanContext)).toBe(`00-${TRACE_ID}-${SPAN_ID}-01`);
  });

  it('未采样 ⇒ 标志位 00（仍可透传）', () => {
    expect(buildTraceparent({ ...spanContext, traceFlags: 0 })).toBe(
      `00-${TRACE_ID}-${SPAN_ID}-00`
    );
  });

  it('全零 / 长度不符的 id ⇒ 不构造（不发坏头）', () => {
    expect(buildTraceparent(undefined)).toBeUndefined();
    expect(
      buildTraceparent({ ...spanContext, traceId: '0'.repeat(32) })
    ).toBeUndefined();
    expect(
      buildTraceparent({ ...spanContext, traceId: TRACE_ID.slice(1) })
    ).toBeUndefined();
    expect(
      buildTraceparent({ ...spanContext, traceId: TRACE_ID.toUpperCase() })
    ).toBeUndefined();
    expect(
      buildTraceparent({ ...spanContext, spanId: '0'.repeat(16) })
    ).toBeUndefined();
    expect(
      buildTraceparent({ ...spanContext, spanId: SPAN_ID.slice(1) })
    ).toBeUndefined();
  });
});

describe('traceparent 注入', () => {
  it('有活动 span ⇒ currentTraceparent 取到它', () => {
    expect(withActiveSpan(() => currentTraceparent())).toBe(
      `00-${TRACE_ID}-${SPAN_ID}-01`
    );
  });

  it('无活动 span ⇒ undefined（不伪造 trace）', () => {
    expect(currentTraceparent()).toBeUndefined();
  });

  it('有活动 span ⇒ 头里多出 traceparent，原有头保留', () => {
    const merged = withActiveSpan(() =>
      withTraceparentHeaders({ 'Content-Type': 'application/json' })
    );
    expect(merged[TRACEPARENT_HEADER]).toBe(`00-${TRACE_ID}-${SPAN_ID}-01`);
    expect(merged['Content-Type']).toBe('application/json');
  });

  it('无活动 span ⇒ 原样返回入参（不制造额外对象）', () => {
    const headers = { 'Content-Type': 'application/json' };
    expect(withTraceparentHeaders(headers)).toBe(headers);
    expect(headers).not.toHaveProperty(TRACEPARENT_HEADER);
  });

  it('调用方显式提供（任意大小写）⇒ 不覆盖', () => {
    const merged = withActiveSpan(() =>
      withTraceparentHeaders({ Traceparent: '00-manual' })
    );
    expect(merged['Traceparent']).toBe('00-manual');
    expect(merged[TRACEPARENT_HEADER]).toBeUndefined();
  });

  it('runWithActiveSpan ⇒ await 之后仍在同一上下文（异步边界不丢）', async () => {
    const span = trace.wrapSpanContext(spanContext);
    const seen = await runWithActiveSpan(span, async () => {
      await new Promise((r) => setTimeout(r, 1));
      return currentTraceparent();
    });
    expect(seen).toBe(`00-${TRACE_ID}-${SPAN_ID}-01`);
    // 离开作用域后不残留
    expect(currentTraceparent()).toBeUndefined();
  });
});
