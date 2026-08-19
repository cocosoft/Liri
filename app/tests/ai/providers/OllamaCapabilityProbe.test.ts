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
 * OllamaProvider.probeCapabilities 静态能力探测测试（2026-08-19）
 *
 * 覆盖「模型能力自动探测」的核心解析逻辑（GET /api/show）：
 *   1. 聊天模板含工具槽位（{{.Tools}}/{{.ToolCalls}}/tool_calls）→ tool_use=true
 *   2. 模板无工具槽位 → tool_use=false（与 qwen3.6-27b 实际 400 行为一致）
 *   3. projector_info 存在 → vision=true；缺失 → vision=false
 *   4. 探测失败/异常 → 返回 unknown（不阻断主流程）
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { OllamaProvider } from '../../../src/ai/providers/OllamaProvider.js';

let originalFetch: typeof fetch;

function mockFetch(
  handler: (url: string) => Response | Promise<Response>
): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    return handler(url);
  }) as typeof fetch;
}

function showResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeProvider(): OllamaProvider {
  return new OllamaProvider({
    providerId: 'test-ollama',
    displayName: 'Ollama',
    defaultBaseUrl: 'http://localhost:11434',
  });
}

describe('OllamaProvider.probeCapabilities（/api/show 静态探测）', () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('模板含 {{.Tools}} / {{- if .Tools }} 槽位 → tool_use=true', async () => {
    mockFetch((url) => {
      expect(url).toContain('/api/show');
      return showResponse({
        template: '{{- if .Tools }}<tool_call>...{{- range .Tools }}{{ end }}',
      });
    });
    const result = await makeProvider().probeCapabilities('qwen3:32b');
    expect(result.tool_use).toBe(true);
  });

  it('模板含 {{.ToolCalls}} 槽位 → tool_use=true', async () => {
    mockFetch(() => showResponse({ template: '{{.ToolCalls}} 渲染' }));
    const result = await makeProvider().probeCapabilities('some-model');
    expect(result.tool_use).toBe(true);
  });

  it('模板无工具槽位 → tool_use=false（qwen3.6-27b 场景）', async () => {
    mockFetch(() =>
      showResponse({
        template: '<|im_start|>system\n{{.System}}<|im_end|>',
        projector_info: undefined,
      })
    );
    const result = await makeProvider().probeCapabilities(
      'registry.ollama.ai/library/qwen3.6-27b:latest'
    );
    expect(result.tool_use).toBe(false);
    expect(result.vision).toBe(false);
  });

  it('projector_info 存在 → vision=true', async () => {
    mockFetch(() =>
      showResponse({
        template: '{{.Tools}}',
        projector_info: { clip: { model: 'clip' } },
      })
    );
    const result = await makeProvider().probeCapabilities('llava');
    expect(result.vision).toBe(true);
  });

  it('接口返回非 200 → unknown（不阻断）', async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ error: 'model not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    const result = await makeProvider().probeCapabilities('no-such-model');
    expect(result.tool_use).toBe('unknown');
    expect(result.vision).toBe('unknown');
  });

  it('fetch 异常 → unknown（不阻断）', async () => {
    mockFetch(() => {
      throw new Error('connection refused');
    });
    const result = await makeProvider().probeCapabilities('any-model');
    expect(result.tool_use).toBe('unknown');
    expect(result.vision).toBe('unknown');
  });
});
