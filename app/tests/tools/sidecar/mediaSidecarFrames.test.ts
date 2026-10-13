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
 * 媒体侧车 **进程内帧契约** 单测（S5/T5.1）。
 *
 * 覆盖（spec §5 / §6）：
 * - 就绪首帧 `startup`（含 `protocolVersion`）；
 * - `media.analyze`（OCR/objects/similarity）经端口返回同形状结果；
 * - 未覆盖能力 / 未知方法 ⇒ **fail-closed** `{success:false, error.code:NOT_IMPLEMENTED}`；
 * - `media.resize` 经 resize 端口返回 `bufferBase64`；
 * - `notify{cancel}` ⇒ 中止在飞请求（response `success:false` / `CANCELLED`）。
 */
import { describe, expect, it } from 'bun:test';
import { PassThrough } from 'node:stream';
import { startMediaSidecar } from '../../../src/tools/sidecar/mediaSidecar';
import type {
  MediaAnalysisPort,
  MediaResizePort,
} from '../../../src/tools/sidecar/mediaCapabilities';
import {
  SIDECAR_IPC_PROTOCOL_VERSION,
  SIDECAR_STARTUP_TYPE,
  encodeFrame,
  decodeFrame,
} from '../../../src/utils/sidecarIpc';

const tick = (ms = 10): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(
  cond: () => boolean,
  timeoutMs = 1000,
  stepMs = 5
): Promise<void> {
  const start = Date.now();
  while (!cond() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

function ipcFrames(chunks: Buffer[]): Array<Record<string, unknown>> {
  return Buffer.concat(chunks)
    .toString('utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => decodeFrame(l))
    .filter((f): f is Record<string, unknown> => f !== null);
}

const stubAnalysis = (
  analyze: MediaAnalysisPort['analyze']
): MediaAnalysisPort => ({ analyze, dispose: () => {} });

const noopResize: MediaResizePort = {
  resize: async (image) => image,
  dispose: () => {},
};

function harness(ports: {
  analysisPortFactory: () => MediaAnalysisPort;
  resizePortFactory?: () => MediaResizePort;
}): { input: PassThrough; output: PassThrough; chunks: Buffer[] } {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (c: Buffer) => chunks.push(c));
  startMediaSidecar({
    input,
    output,
    heartbeatMs: 100_000,
    pid: 1,
    analysisPortFactory: ports.analysisPortFactory,
    resizePortFactory: ports.resizePortFactory ?? (() => noopResize),
  });
  return { input, output, chunks };
}

describe('媒体侧车·进程内帧契约', () => {
  it('就绪首帧为 startup（含 protocolVersion）', () => {
    const { chunks } = harness({
      analysisPortFactory: () => stubAnalysis(async () => ({})),
    });
    const first = ipcFrames(chunks)[0];
    expect(first).toBeDefined();
    expect(first!.type).toBe(SIDECAR_STARTUP_TYPE);
    expect(first!.protocolVersion).toBe(SIDECAR_IPC_PROTOCOL_VERSION);
  });

  it('media.analyze(ocr) 经端口返回同形状结果', async () => {
    const calls: Array<{ kind: string; params: Record<string, unknown> }> = [];
    const { input, chunks } = harness({
      analysisPortFactory: () =>
        stubAnalysis(async (kind, params) => {
          calls.push({ kind, params });
          return {
            text: 'HELLO',
            confidence: 1,
            blocks: [],
            language: 'en',
          };
        }),
    });
    await tick();
    input.write(
      encodeFrame({
        id: 'r1',
        method: 'media.analyze',
        params: { kind: 'ocr', image_path: '/tmp/a.png' },
      })
    );
    await waitFor(() => ipcFrames(chunks).some((f) => f.id === 'r1'));
    const res = ipcFrames(chunks).find((f) => f.id === 'r1')!;
    expect(res.success).toBe(true);
    expect(res.result).toMatchObject({ text: 'HELLO', confidence: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe('ocr');
    expect(calls[0].params).toMatchObject({ image_path: '/tmp/a.png' });
  });

  it('media.analyze 未覆盖能力（sam_segment）⇒ NOT_IMPLEMENTED fail-closed', async () => {
    const { input, chunks } = harness({
      analysisPortFactory: () => stubAnalysis(async () => ({ fake: true })),
    });
    await tick();
    input.write(
      encodeFrame({
        id: 'r1',
        method: 'media.analyze',
        params: { kind: 'sam_segment' },
      })
    );
    await waitFor(() => ipcFrames(chunks).some((f) => f.id === 'r1'));
    const res = ipcFrames(chunks).find((f) => f.id === 'r1')!;
    expect(res.success).toBe(false);
    expect((res.error as { code?: string }).code).toBe('NOT_IMPLEMENTED');
  });

  it('media.resize 经 resize 端口返回 bufferBase64（同形状）', async () => {
    const src = Buffer.from('RAW');
    const out = Buffer.from('JPEGDATA');
    const seen: Array<{ maxSide: number; quality: number; len: number }> = [];
    const { input, chunks } = harness({
      analysisPortFactory: () => stubAnalysis(async () => ({})),
      resizePortFactory: () => ({
        resize: async (image, maxSide, quality) => {
          seen.push({ maxSide, quality, len: image.length });
          return out;
        },
        dispose: () => {},
      }),
    });
    await tick();
    input.write(
      encodeFrame({
        id: 'r1',
        method: 'media.resize',
        params: {
          imageBase64: src.toString('base64'),
          maxSide: 800,
          quality: 85,
        },
      })
    );
    await waitFor(() => ipcFrames(chunks).some((f) => f.id === 'r1'));
    const res = ipcFrames(chunks).find((f) => f.id === 'r1')!;
    expect(res.success).toBe(true);
    expect(res.result).toMatchObject({
      bufferBase64: out.toString('base64'),
      shrunk: true,
    });
    expect(seen).toEqual([{ maxSide: 800, quality: 85, len: 3 }]);
  });

  it('notify{cancel} ⇒ 中止在飞 analyze（response success:false / CANCELLED）', async () => {
    const { input, chunks } = harness({
      analysisPortFactory: () =>
        stubAnalysis(
          (_kind, _params, signal) =>
            new Promise((_resolve, reject) => {
              signal?.addEventListener('abort', () =>
                reject(new Error('aborted'))
              );
            })
        ),
    });
    await tick();
    input.write(
      encodeFrame({
        id: 'r1',
        method: 'media.analyze',
        params: { kind: 'ocr', image_path: '/tmp/a.png' },
      })
    );
    await tick(20);
    input.write(
      encodeFrame({ type: 'notify', event: 'cancel', data: { id: 'r1' } })
    );
    await waitFor(() => ipcFrames(chunks).some((f) => f.id === 'r1'));
    const res = ipcFrames(chunks).find((f) => f.id === 'r1')!;
    expect(res.success).toBe(false);
    expect((res.error as { code?: string }).code).toBe('CANCELLED');
  });

  it('未知方法 ⇒ NOT_IMPLEMENTED fail-closed', async () => {
    const { input, chunks } = harness({
      analysisPortFactory: () => stubAnalysis(async () => ({})),
    });
    await tick();
    input.write(encodeFrame({ id: 'r1', method: 'media.nope', params: {} }));
    await waitFor(() => ipcFrames(chunks).some((f) => f.id === 'r1'));
    const res = ipcFrames(chunks).find((f) => f.id === 'r1')!;
    expect(res.success).toBe(false);
    expect((res.error as { code?: string }).code).toBe('NOT_IMPLEMENTED');
  });
});
