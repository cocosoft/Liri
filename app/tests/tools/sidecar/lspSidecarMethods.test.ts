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
 * LSP 侧车 **真实方法分派**单测（S2/T2.2 侧车侧）。
 *
 * 注入**假 LSP 连接**（`connectionFactory`）⇒ 不真起进程即可断言：
 * - `initialize` / `hover` / `definition` 被翻译为 LSP 查询并回**真实结果**；
 * - **未覆盖**的方法 ⇒ fail-closed 回 `NOT_IMPLEMENTED`（**不伪造成功**，CS03）；
 * - 未初始化且无 `language` ⇒ fail-closed `NOT_INITIALIZED`。
 */
import { describe, expect, it } from 'bun:test';
import { PassThrough } from 'node:stream';
import { startLspSidecar } from '../../../src/tools/sidecar/lspSidecar';
import type {
  LspConnectionOptions,
  LspConnectionPort,
  LspLocation,
  LspPosition,
} from '../../../src/tools/sidecar/lspConnection';
import { decodeFrame, encodeFrame } from '../../../src/utils/sidecarIpc';

const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms));

const fakeLocation: LspLocation = {
  uri: 'file:///fake.ts',
  range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
};

class FakeConnection implements LspConnectionPort {
  startCalls = 0;
  hoverCalls: Array<{ document: string; position: LspPosition }> = [];
  definitionCalls: Array<{ document: string; position: LspPosition }> = [];
  constructor(readonly opts: LspConnectionOptions) {}
  async start(): Promise<void> {
    this.startCalls += 1;
  }
  async hover(document: string, position: LspPosition): Promise<string | null> {
    this.hoverCalls.push({ document, position });
    return 'FAKE_HOVER';
  }
  async definition(
    document: string,
    position: LspPosition
  ): Promise<LspLocation[]> {
    this.definitionCalls.push({ document, position });
    return [fakeLocation];
  }
  async stop(): Promise<void> {
    /* no-op */
  }
}

function harness(): {
  input: PassThrough;
  lines: () => string[];
  created: FakeConnection[];
} {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (c: Buffer) => chunks.push(c));
  const created: FakeConnection[] = [];
  startLspSidecar({
    input,
    output,
    heartbeatMs: 100_000,
    pid: 7,
    connectionFactory: (opts) => {
      const c = new FakeConnection(opts);
      created.push(c);
      return c;
    },
  });
  return {
    input,
    created,
    lines: () =>
      Buffer.concat(chunks)
        .toString()
        .split('\n')
        .filter((l) => l.trim().length > 0),
  };
}

async function call(
  h: { input: PassThrough; lines: () => string[] },
  id: string,
  method: string,
  params: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const before = h.lines().length;
  h.input.write(encodeFrame({ id, method, params }));
  await tick();
  const after = h.lines();
  for (let i = before; i < after.length; i += 1) {
    const frame = decodeFrame(after[i]);
    if (frame && frame.id === id) return frame;
  }
  return null;
}

describe('LSP 侧车：initialize', () => {
  it('language ⇒ 建立/持有连接并回 {initialized:true}', async () => {
    const h = harness();
    const res = await call(h, 'r0', 'lsp.initialize', {
      language: 'typescript',
    });
    expect(res?.success).toBe(true);
    expect(res?.result).toEqual({ language: 'typescript', initialized: true });
    expect(h.created.length).toBe(1);
    expect(h.created[0].opts.language).toBe('typescript');
    expect(h.created[0].startCalls).toBe(1);
  });
});

describe('LSP 侧车：hover / definition', () => {
  it('hover ⇒ 翻译为 LSP 查询并回真实结果', async () => {
    const h = harness();
    await call(h, 'r0', 'lsp.initialize', { language: 'typescript' });
    const res = await call(h, 'r1', 'lsp.hover', {
      language: 'typescript',
      document: 'const x = 1;',
      position: { line: 0, character: 6 },
    });
    expect(res?.success).toBe(true);
    expect(res?.result).toBe('FAKE_HOVER');
    expect(h.created[0].hoverCalls).toEqual([
      { document: 'const x = 1;', position: { line: 0, character: 6 } },
    ]);
  });

  it('definition ⇒ 回 Location[] 形状', async () => {
    const h = harness();
    const res = await call(h, 'r1', 'lsp.definition', {
      language: 'typescript',
      document: 'const x = 1;',
      position: { line: 0, character: 6 },
    });
    expect(res?.success).toBe(true);
    expect(res?.result).toEqual([fakeLocation]);
  });

  it('未初始化且无 language ⇒ fail-closed NOT_INITIALIZED', async () => {
    const h = harness();
    const res = await call(h, 'r1', 'lsp.hover', { document: 'x' });
    expect(res?.success).toBe(false);
    expect((res?.error as { code?: string }).code).toBe('NOT_INITIALIZED');
  });
});

describe('LSP 侧车：未覆盖方法 fail-closed', () => {
  it('rename（本期未覆盖）⇒ NOT_IMPLEMENTED，不伪造成功', async () => {
    const h = harness();
    const res = await call(h, 'r1', 'lsp.rename', {
      language: 'typescript',
      newName: 'y',
    });
    expect(res?.success).toBe(false);
    expect((res?.error as { code?: string }).code).toBe('NOT_IMPLEMENTED');
  });
});
