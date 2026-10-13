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
 * 媒体侧车 **消费者适配端口** 单测（S5/T5.1 + T5.2）。
 *
 * 覆盖：
 * - `createL2WorkerPort`：L2 方法（ocr/object_detection/image_similarity）经 `media.analyze`
 *   映射转发；未覆盖方法（sam_segment/depth_estimate）与侧车不可用 ⇒ **fail-closed 抛错**（不回落内置）；
 * - `resizeViaMediaSidecar`：`media.resize` 请求体为 base64 + 参数，响应 base64 解码为 Buffer。
 */
import { describe, expect, it } from 'bun:test';
import {
  createL2WorkerPort,
  resizeViaMediaSidecar,
  type MediaSupervisorProvider,
  type MediaSupervisorRequester,
} from '../../../src/tools/sidecar/SidecarMediaAnalyzer';

function stubRequester(
  handler: (
    method: string,
    params: Record<string, unknown>
  ) => Record<string, unknown>
): {
  requester: MediaSupervisorRequester;
  calls: Array<{ method: string; params: Record<string, unknown> }>;
} {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  return {
    calls,
    requester: {
      async request(
        method: string,
        params?: Record<string, unknown>
      ): Promise<Record<string, unknown>> {
        const p = params ?? {};
        calls.push({ method, params: p });
        return handler(method, p);
      },
    },
  };
}

const provider =
  (r: MediaSupervisorRequester | null): MediaSupervisorProvider =>
  async () =>
    r;

describe('媒体侧车·L2 Worker 端口', () => {
  it('ocr ⇒ media.analyze kind=ocr，返回 payload（同形状）', async () => {
    const { requester, calls } = stubRequester(() => ({
      id: 'x',
      success: true,
      result: { text: 'HI', confidence: 0.9, blocks: [] },
    }));
    const port = createL2WorkerPort(provider(requester));
    const payload = await port.requestResult<{ text: string }>('ocr', {
      image_path: '/tmp/a.png',
      languages: ['en'],
    });
    expect(payload).toMatchObject({ text: 'HI', confidence: 0.9 });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('media.analyze');
    expect(calls[0].params).toMatchObject({
      kind: 'ocr',
      image_path: '/tmp/a.png',
    });
  });

  it('object_detection / image_similarity ⇒ kind=objects / similarity', async () => {
    const { requester, calls } = stubRequester(() => ({
      id: 'x',
      success: true,
      result: {},
    }));
    const port = createL2WorkerPort(provider(requester));
    await port.requestResult('object_detection', { image_path: '/tmp/a.png' });
    await port.requestResult('image_similarity', { image_path: '/tmp/a.png' });
    expect(calls.map((c) => c.params.kind)).toEqual(['objects', 'similarity']);
  });

  it('未覆盖方法（sam_segment）⇒ fail-closed 抛错（不回落内置）', async () => {
    const { requester, calls } = stubRequester(() => ({
      id: 'x',
      success: true,
      result: {},
    }));
    const port = createL2WorkerPort(provider(requester));
    await expect(
      port.requestResult('sam_segment', { image_path: '/tmp/a.png' })
    ).rejects.toThrow('未覆盖');
    expect(calls).toHaveLength(0);
  });

  it('侧车不可用（provider ⇒ null）⇒ fail-closed 抛错（不回落内置 WorkerGuard）', async () => {
    const port = createL2WorkerPort(provider(null));
    await expect(
      port.requestResult('ocr', { image_path: '/tmp/a.png' })
    ).rejects.toThrow('媒体侧车不可用');
  });
});

describe('媒体侧车·resize 收口端口', () => {
  it('resizeViaMediaSidecar：base64 请求 + 解码响应', async () => {
    const src = Buffer.from('SRCIMAGE');
    const { requester, calls } = stubRequester(() => ({
      id: 'x',
      success: true,
      result: { bufferBase64: Buffer.from('JPEG').toString('base64') },
    }));
    const out = await resizeViaMediaSidecar(src, 800, 85, provider(requester));
    expect(out.toString()).toBe('JPEG');
    expect(calls[0].method).toBe('media.resize');
    expect(calls[0].params).toMatchObject({
      maxSide: 800,
      quality: 85,
      imageBase64: src.toString('base64'),
    });
  });

  it('侧车不可用（provider ⇒ null）⇒ fail-closed 抛错', async () => {
    await expect(
      resizeViaMediaSidecar(Buffer.from('X'), 400, 60, provider(null))
    ).rejects.toThrow('媒体侧车不可用');
  });
});
