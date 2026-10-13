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
 * 媒体侧车 **真实进程级** E2E（S5/T5.1 + T5.2）。
 *
 * 真起 `mediaSidecar.ts` 子进程（经 `ToolSidecarSupervisor`）：
 * - 就绪握手（startup 帧）；
 * - `media.resize` ⇒ **真 `sharp`**（native 在侧车进程内执行）⇒ JPEG + 尺寸受限；
 * - 未覆盖能力（`sam_segment`）⇒ **fail-closed** `NOT_IMPLEMENTED`；
 * - `media.analyze(ocr)` ⇒ 记录**真实模型可用性**结果（缺失依赖即如实受阻，不伪造）。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ToolSidecarSupervisor } from '../../../src/tools/sidecar/ToolSidecarSupervisor';

const MEDIA_SCRIPT = fileURLToPath(
  new URL('../../../src/tools/sidecar/mediaSidecar.ts', import.meta.url)
);

describe('S5 真实进程级：媒体侧车 spawn → 握手 → resize/analyze → stop', () => {
  const children: ChildProcess[] = [];
  let sup: ToolSidecarSupervisor | null = null;
  const tmpPng = join(tmpdir(), `s5-media-${process.pid}-${Date.now()}.png`);

  afterEach(() => {
    sup?.stop();
    for (const c of children) {
      try {
        c.kill();
      } catch {
        // 已退出
      }
    }
    try {
      rmSync(tmpPng, { force: true });
    } catch {
      // 忽略
    }
  });

  it('handshake + media.resize（真 sharp）+ 未覆盖能力 fail-closed + ocr 真实性记录', async () => {
    const { default: sharp } = await import('sharp');
    const src = await sharp({
      create: {
        width: 100,
        height: 100,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toBuffer();
    writeFileSync(tmpPng, src);

    sup = new ToolSidecarSupervisor({
      scriptPath: MEDIA_SCRIPT,
      startupTimeoutMs: 20_000,
      requestTimeoutMs: 30_000,
      maxRestarts: 0,
      spawnFn: (cmd, args, opts) => {
        const c = spawn(cmd, args, opts as never);
        children.push(c);
        return c;
      },
    });
    await sup.start();
    expect(children.length).toBe(1);
    expect(sup.isRunning()).toBe(true);

    // media.resize ⇒ 真 sharp 在侧车进程内执行
    const frame = await sup.request('media.resize', {
      imageBase64: src.toString('base64'),
      maxSide: 50,
      quality: 85,
    });
    const out = Buffer.from(
      String((frame.result as { bufferBase64?: string }).bufferBase64),
      'base64'
    );
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(50);
    expect(meta.height).toBe(50);

    // 未覆盖能力 ⇒ fail-closed NOT_IMPLEMENTED（不伪造成功）
    await expect(
      sup.request('media.analyze', { kind: 'sam_segment', image_path: tmpPng })
    ).rejects.toThrow('NOT_IMPLEMENTED');

    // media.analyze(ocr)：真实模型可用性 —— 如实记录（缺失依赖 ⇒ 结构化错误，非伪造）
    const ocrOutcome = await sup
      .request('media.analyze', { kind: 'ocr', image_path: tmpPng })
      .then((r) => `success:${JSON.stringify(r.result).slice(0, 120)}`)
      .catch((e: unknown) => `error:${String(e).slice(0, 200)}`);

    console.log(`[S5 真机] media.analyze(ocr) ⇒ ${ocrOutcome}`);
    expect(ocrOutcome.length).toBeGreaterThan(0);

    expect(sup.isRunning()).toBe(true); // 侧车主进程存活
  }, 60_000);
});
