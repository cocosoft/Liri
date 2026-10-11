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
 * S2-2（2026-10-11，G15）—— **取消全链路**：MCP / WebFetch 的取消信号接线。
 *
 * 修复前：`MCPTool` / `McpToolWrapper` 未把上下文取消信号传给 SDK `callTool`，
 * `WebFetchTool` 自建 controller 仅做超时 ⇒ 用户取消（`abortController.abort()`）后
 * 底层请求仍继续。本文件断言"取消 ⇒ 在途请求收到已中止的 signal"。
 *
 * WebFetch 用例以字面量公网 IP（`93.184.216.34`）绕过 DNS，并打桩 `globalThis.fetch`
 * 捕获真实传给 `fetch` 的 `signal`（离线、确定）。
 */
import { describe, it, expect, afterEach, spyOn } from 'bun:test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { WebFetchTool } from '../../src/tools/WebFetchTool/WebFetchTool.js';
import { McpToolWrapper } from '../../src/services/mcp/McpToolWrapper.js';
import { MCPTool } from '../../src/mcp/MCPTool.js';
import { mcpConnectionManager } from '../../src/services/mcp/MCPConnectionManager.js';

/** 最小可用上下文（仅取 abortController；`toolUseId` 供进度回调） */
function ctx(controller: AbortController) {
  return { abortController: controller, toolUseId: 'tc-1' } as never;
}

const ORIG_FETCH = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = ORIG_FETCH;
});

/** 轮询等待某个条件成立（避免依赖具体 tick 数） */
async function waitFor(cond: () => boolean, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while (!cond() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2));
  }
}

describe('S2-2 取消全链路（G15）', () => {
  it('WebFetchTool：上下文取消 ⇒ 在途 fetch 的 signal 中止，且结果报"已取消"（非"超时"）', async () => {
    let received: AbortSignal | undefined;
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      received = init?.signal as AbortSignal;
      return await new Promise<Response>((_resolve, reject) => {
        received?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError'))
        );
      });
    }) as typeof fetch;

    const controller = new AbortController();
    const p = new WebFetchTool().execute(
      { url: 'http://93.184.216.34/' },
      ctx(controller)
    );
    await waitFor(() => received !== undefined);
    expect(received).toBeDefined();
    expect(received!.aborted).toBe(false);

    controller.abort();
    const r = await p;
    expect(received!.aborted).toBe(true);
    // 语义区分：用户取消 ≠ 超时（原实现一律报"超时"）
    expect(String(r.data)).toContain('Request canceled');
  });

  it('McpToolWrapper：把 `options.signal` 传给 SDK `callTool`（取消 ⇒ 中止）', async () => {
    let captured: AbortSignal | undefined;
    const fakeClient = {
      callTool: async (
        _p: unknown,
        _s: unknown,
        options?: { signal?: AbortSignal }
      ) => {
        captured = options?.signal;
        return { content: [{ type: 'text', text: 'ok' }], isError: false };
      },
    } as unknown as Client;

    const wrapper = new McpToolWrapper(
      'srv',
      { name: 't', description: 'd' } as never,
      () => fakeClient
    );
    const controller = new AbortController();
    const r = await wrapper.execute({}, ctx(controller));

    expect(r.success).toBe(true);
    expect(captured).toBeDefined();
    expect(captured!.aborted).toBe(false);
    controller.abort();
    expect(captured!.aborted).toBe(true);
  });

  it('MCPTool(action=call)：把 `options.signal` 传给 SDK `callTool`（取消 ⇒ 中止）', async () => {
    let captured: AbortSignal | undefined;
    const fakeSdk = {
      callTool: async (
        _p: unknown,
        _s: unknown,
        options?: { signal?: AbortSignal }
      ) => {
        captured = options?.signal;
        return { content: [{ type: 'text', text: 'ok' }], isError: false };
      },
    };
    const spy = spyOn(mcpConnectionManager, 'getSdkClient').mockReturnValue(
      fakeSdk as never
    );
    try {
      const controller = new AbortController();
      const r = await MCPTool.execute(
        { action: 'call', server_name: 'srv', tool_name: 't', tool_args: {} },
        ctx(controller)
      );

      expect(r.success).toBe(true);
      expect(captured).toBeDefined();
      expect(captured!.aborted).toBe(false);
      controller.abort();
      expect(captured!.aborted).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});
