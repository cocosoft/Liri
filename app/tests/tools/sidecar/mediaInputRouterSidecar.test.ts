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
 * `ImageInputRouter` **sharp 收口一处** 单测（S5/T5.2）。
 *
 * 收口点 = 超大图（>maxBytes）逐级缩放的动态 `import('sharp')`。
 *
 * 锁定：
 * - 开关关（默认）⇒ 走**原本地 sharp 路径**（逐字等价）；
 * - 开关开 ⇒ 经注入的 media 侧车后端执行；**同输入同参数 ⇒ 与本地路径字节级等价**；
 * - 开关开 + 侧车失败 ⇒ **不静默回落本地 sharp**（fail-closed：返回原图，`shrunk:false`）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { ImageInputRouter } from '../../../src/tools/ImageGenerateTool/ImageInputRouter';

const ENV_MEDIA = 'FEATURE_TOOL_SIDECAR_MEDIA';
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[ENV_MEDIA];
  delete process.env[ENV_MEDIA];
});
afterEach(() => {
  if (saved === undefined) delete process.env[ENV_MEDIA];
  else process.env[ENV_MEDIA] = saved;
});

/** 与收口点**同参数**的本地 sharp 缩放（等价性对照后端） */
async function sharpResize(
  image: Buffer,
  maxSide: number,
  quality: number
): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  return sharp(image)
    .resize(maxSide, maxSide, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
}

/** 生成一张足够大的噪声 PNG（保证 > maxBytes，触发缩放） */
async function makeLargeImage(): Promise<Buffer> {
  const { default: sharp } = await import('sharp');
  const width = 2600;
  const height = 2600;
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) % 256;
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer();
}

const isJpeg = (buf: Buffer): boolean =>
  buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;

describe('T5.2 · sharp 收口一处（ImageInputRouter.shrinkIfNeeded）', () => {
  it('开关关 ⇒ 本地 sharp 路径生效（原路径逐字，等价基线）', async () => {
    const big = await makeLargeImage();
    const maxBytes = Math.floor(big.length / 2);
    const router = new ImageInputRouter();
    const res = await router.shrinkIfNeeded(big, maxBytes);
    if (res.shrunk) {
      expect(res.buffer.length).toBeLessThanOrEqual(maxBytes);
      expect(isJpeg(res.buffer)).toBe(true);
    }
  });

  it('开关开 ⇒ 经媒体侧车后端，且与本地路径**字节级等价**', async () => {
    const big = await makeLargeImage();
    const maxBytes = Math.floor(big.length / 2);

    const off = await new ImageInputRouter().shrinkIfNeeded(big, maxBytes);

    process.env[ENV_MEDIA] = 'true';
    const calls: Array<{ maxSide: number; quality: number }> = [];
    const on = await new ImageInputRouter(async (img, maxSide, quality) => {
      calls.push({ maxSide, quality });
      return sharpResize(img, maxSide, quality);
    }).shrinkIfNeeded(big, maxBytes);

    // 收口后**确实**经侧车后端（未静默回落本地 sharp）
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toMatchObject({ maxSide: 2048, quality: 85 });
    // 同输入同参数 ⇒ 结果等价
    expect(on.shrunk).toBe(off.shrunk);
    expect(on.buffer.equals(off.buffer)).toBe(true);
  });

  it('开关开 + 侧车后端失败 ⇒ fail-closed（不静默回落本地 sharp）', async () => {
    const big = await makeLargeImage();
    const maxBytes = Math.floor(big.length / 2);
    process.env[ENV_MEDIA] = 'true';
    const router = new ImageInputRouter(async () => {
      throw new Error('media sidecar down');
    });
    const res = await router.shrinkIfNeeded(big, maxBytes);
    expect(res.shrunk).toBe(false);
    expect(res.buffer).toBe(big); // 原图返回，未用本地 sharp 缩放
  });
});
