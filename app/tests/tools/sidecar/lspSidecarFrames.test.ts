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
 * LSP 侧车 **进程入口**分帧单测（S1 骨架）。
 *
 * 注入 PassThrough 流 ⇒ **不真起进程**即可断言：首发 `startup` 帧（含 `protocolVersion`/`pid`）；
 * **未覆盖**方法之请求 ⇒ fail-closed 回 `NOT_IMPLEMENTED`（不伪造成功）；非法行被忽略
 * （`decodeFrame` ⇒ null）。（已接线方法的翻译见 `lspSidecarMethods.test.ts`。）
 */
import { describe, expect, it } from 'bun:test';
import { PassThrough } from 'node:stream';
import { startLspSidecar } from '../../../src/tools/sidecar/lspSidecar';
import {
  SIDECAR_IPC_PROTOCOL_VERSION,
  decodeFrame,
  encodeFrame,
} from '../../../src/utils/sidecarIpc';

const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms));

function collect(output: PassThrough): () => string[] {
  const chunks: Buffer[] = [];
  output.on('data', (c: Buffer) => chunks.push(c));
  return () =>
    Buffer.concat(chunks)
      .toString()
      .split('\n')
      .filter((l) => l.trim().length > 0);
}

describe('LSP 侧车入口：就绪握手', () => {
  it('首发 startup 帧（含 protocolVersion 与 pid）', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines = collect(output);
    const handle = startLspSidecar({
      input,
      output,
      heartbeatMs: 100_000,
      pid: 4242,
    });
    await tick();
    expect(decodeFrame(lines()[0])).toEqual({
      type: 'startup',
      protocolVersion: SIDECAR_IPC_PROTOCOL_VERSION,
      pid: 4242,
    });
    handle.stop();
  });
});

describe('LSP 侧车入口：请求 / 非法行', () => {
  it('未覆盖方法请求 ⇒ fail-closed 回 NOT_IMPLEMENTED（不伪造成功）', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines = collect(output);
    const handle = startLspSidecar({
      input,
      output,
      heartbeatMs: 100_000,
      pid: 1,
    });
    await tick();
    input.write(encodeFrame({ id: 'r1', method: 'lsp.rename' }));
    await tick();
    const res = decodeFrame(lines()[1]);
    expect(res?.id).toBe('r1');
    expect(res?.success).toBe(false);
    expect((res?.error as { code?: string } | undefined)?.code).toBe(
      'NOT_IMPLEMENTED'
    );
    handle.stop();
  });

  it('非法行 / 调试输出被忽略（decodeFrame ⇒ null）', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines = collect(output);
    const handle = startLspSidecar({
      input,
      output,
      heartbeatMs: 100_000,
      pid: 1,
    });
    await tick();
    const before = lines().length;
    input.write('not json\n');
    await tick();
    expect(lines().length).toBe(before);
    handle.stop();
  });

  it('notify 帧被消费（不产生 response）', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const lines = collect(output);
    const handle = startLspSidecar({
      input,
      output,
      heartbeatMs: 100_000,
      pid: 1,
    });
    await tick();
    const before = lines().length;
    input.write(encodeFrame({ type: 'notify', event: 'cancel', data: {} }));
    await tick();
    expect(lines().length).toBe(before);
    handle.stop();
  });
});
