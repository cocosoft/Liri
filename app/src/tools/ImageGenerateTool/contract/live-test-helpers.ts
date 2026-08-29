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
 * Live Test Helpers — 生图 Provider 真实 API 测试辅助
 *
 * 提供真实 API 调用的测试辅助函数，用于端到端验证 Provider。
 * 所有测试默认 skip，仅当环境变量启用时才运行。
 *
 * 参照 openclaw live-test-helpers.ts
 */

import { test } from 'bun:test';
import type { ImageGenerationResult } from '@modules/ai';

/** 检查是否应该跳过 Live 测试 */
export function skipIfNotConfigured(envKey: string): boolean {
  const configured = !!process.env[envKey];
  return !configured;
}

/** 跳过未配置 Provider 的 Live 测试 */
export function liveTest(
  name: string,
  envKey: string,
  fn: () => Promise<void>
): void {
  test(name, async () => {
    if (skipIfNotConfigured(envKey)) {
      // eslint-disable-next-line no-console -- 测试辅助工具，需要直接输出到控制台
      console.log(`  [SKIP] ${envKey} 未配置，跳过 Live 测试`);
      return;
    }
    await fn();
  });
}

/** 验证生成的图片结果格式合法 */
export function assertValidImageResult(result: ImageGenerationResult): void {
  if (!result.success) {
    throw new Error(`图片生成失败: ${result.error}`);
  }
  if (!Array.isArray(result.data) || result.data.length === 0) {
    throw new Error('图片生成结果 data 数组为空');
  }
  const firstImage = result.data[0];
  if (!firstImage.url) {
    throw new Error('图片生成结果缺少 url');
  }
  if (typeof result.durationMs !== 'number' || result.durationMs <= 0) {
    throw new Error(`无效的 durationMs: ${result.durationMs}`);
  }
}

/** 生成标准测试用的生图 prompt */
export function getTestImagePrompt(): string {
  return 'A simple red circle on white background, minimal, clean';
}
