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
 * LandlockDetector 单测（P1，2026-08-25）
 * 平台门控：非 Linux 直接不可用（当前开发机为 Windows，验证 no-linux 分支）。
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { LandlockDetector } from '../LandlockDetector';

describe('LandlockDetector（平台门控）', () => {
  afterEach(() => {
    LandlockDetector.clearCache();
  });

  test('非 Linux 平台返回 no-linux 且 abi=0', async () => {
    // 测试环境为 Windows/macOS 时验证门控；Linux 上本用例仅验证结构可用
    const cap = await LandlockDetector.detect();
    expect(cap).toHaveProperty('available');
    expect(cap).toHaveProperty('abi');
    if (process.platform !== 'linux') {
      expect(cap.available).toBe(false);
      expect(cap.abi).toBe(0);
      expect(cap.reason).toBe('no-linux');
    }
  });

  test('缓存生效：重复调用不重复探测（clearCache 后重置）', async () => {
    if (process.platform === 'linux') return; // Linux 上 probe 有副进程，跳过缓存计数断言
    const first = await LandlockDetector.detect();
    const second = await LandlockDetector.detect();
    expect(second).toEqual(first);
    LandlockDetector.clearCache();
    const third = await LandlockDetector.detect();
    expect(third).toEqual(first);
  });
});
