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
 * LSP 工具侧车 **真实进程级 E2E**（S2/T2.2）。
 *
 * 本机**无** `typescript-language-server`（S0/T0.1 已实证）⇒ 真机 LS 端到端**受阻**；
 * 故用**真实 `spawn` 的假 LS 脚本**（`tests/tools/fixtures/fakeLspMethodsServer.js`）打通：
 * `spawn 侧车 → startup 握手 → lsp.initialize（侧车再 spawn 假 LS）→ lsp.hover / lsp.definition →
 *  结果回传 → stop`。
 *
 * 说明（如实）：本用例验证的是**侧车 ↔ LS 的真实进程管道**；"需真实 LS 才能做的端到端"
 * （真实语义的 hover/definition）**未验证**。
 */
import { describe, expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { ToolSidecarSupervisor } from '../../../src/tools/sidecar/ToolSidecarSupervisor';

const fakeLsScript = fileURLToPath(
  new URL('../fixtures/fakeLspMethodsServer.js', import.meta.url)
);

describe('LSP 工具侧车 E2E（真实进程 + 假 LS）', () => {
  it('spawn → 握手 → initialize → hover → definition → stop', async () => {
    const sup = new ToolSidecarSupervisor({ startupTimeoutMs: 20_000 });
    const started = await sup.start();
    expect(typeof started.pid).toBe('number');

    const init = await sup.request('lsp.initialize', {
      language: 'typescript',
      serverPath: process.execPath,
      serverArgs: [fakeLsScript],
    });
    expect(init.success).toBe(true);
    expect(init.result).toEqual({ language: 'typescript', initialized: true });

    const hover = await sup.request('lsp.hover', {
      language: 'typescript',
      document: 'const x = 1;\n',
      position: { line: 0, character: 6 },
    });
    expect(hover.result).toBe('FAKE_HOVER');

    const def = await sup.request('lsp.definition', {
      language: 'typescript',
      document: 'const x = 1;\n',
      position: { line: 0, character: 6 },
    });
    expect(def.result).toEqual([
      {
        uri: 'file:///fake-target.ts',
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 5 },
        },
      },
    ]);

    sup.stop();
    expect(sup.isRunning()).toBe(false);
  }, 40_000);
});
