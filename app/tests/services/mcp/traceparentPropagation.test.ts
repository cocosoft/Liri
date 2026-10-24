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
 * MCP 出站 `traceparent` 接线自证（基础设施专项 §6-#6）。
 *
 * 单测「函数正确」不够 —— 这里断言**传输层真的把活动 span 带进了请求头**：
 * 用替身 `fetch` 截获 init.headers，不发起真实网络请求。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { context, trace, TraceFlags } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { HTTPTransport } from '../../../src/services/mcp/transports/HTTPTransport';
import { runWithActiveSpan } from '../../../src/monitoring/tracing/traceContextInjector';
import type { MCPRequest, MCPResponse } from '../../../src/services/mcp/types';

const cm = new AsyncLocalStorageContextManager();
cm.enable();
context.setGlobalContextManager(cm);

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const SPAN_ID = 'b7ad6b7169203331';
const EXPECTED = `00-${TRACE_ID}-${SPAN_ID}-01`;

const request: MCPRequest = { id: '1', type: 'list_tools' };
const responseBody: MCPResponse = {
  id: '1',
  request_id: '1',
  type: 'result',
  result: {},
};

const activeSpan = () =>
  trace.wrapSpanContext({
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    traceFlags: TraceFlags.SAMPLED,
    isRemote: false,
  });

describe('MCP 出站 traceparent', () => {
  const originalFetch = globalThis.fetch;
  let seenHeaders: Record<string, string> | undefined;

  beforeEach(() => {
    seenHeaders = undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      seenHeaders = init?.headers as Record<string, string> | undefined;
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('有活动 span ⇒ 请求头带 traceparent', async () => {
    const transport = new HTTPTransport({ url: 'http://127.0.0.1:1/mcp' });
    await transport.connect();

    const res = await runWithActiveSpan(activeSpan(), () =>
      transport.send(request)
    );

    expect(res.id).toBe('1');
    expect(seenHeaders?.['traceparent']).toBe(EXPECTED);
    // 原有头不被挤掉
    expect(seenHeaders?.['Content-Type']).toBe('application/json');
  });

  it('无活动 span ⇒ 不带 traceparent（不发坏头）', async () => {
    const transport = new HTTPTransport({ url: 'http://127.0.0.1:1/mcp' });
    await transport.connect();

    await transport.send(request);

    expect(seenHeaders).toBeDefined();
    expect(seenHeaders).not.toHaveProperty('traceparent');
  });

  it('服务端配置已显式指定 ⇒ 尊重配置，不覆盖', async () => {
    const transport = new HTTPTransport({
      url: 'http://127.0.0.1:1/mcp',
      headers: { traceparent: '00-manual' },
    });
    await transport.connect();

    await runWithActiveSpan(activeSpan(), () => transport.send(request));

    expect(seenHeaders?.['traceparent']).toBe('00-manual');
  });
});
