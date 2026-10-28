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
 * 产品身份前缀 → **路径解析**联动（P1 迁移随行，2026-10-28）
 *
 * 原位于 `packages/kernel/src/kernel.test.ts` 的「注入 envPrefix 后路径解析改用新前缀」。
 * `paths`（含 `resolveDbPath`）已整体迁至 `@modules/environment` ⇒ 该断言随实现迁移，
 * 内核侧只保留**身份契约本身**的用例（默认身份 / 非法输入）。
 *
 * 判据不变：注入后前缀与目录名**真的**跟着变，而不是只改了一个常量。
 */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  configureProductIdentity,
  resetProductIdentity,
} from '@openliri/kernel';
import { resolveDbPath } from '@modules/environment';

describe('产品身份注入 ⇒ 路径解析联动', () => {
  it('注入 envPrefix 后，路径解析改用新前缀；reset 后恢复', () => {
    const fakeHome = join(process.cwd(), 'kernel-test-home');
    const env = (key: string): NodeJS.ProcessEnv => ({ [key]: fakeHome });

    // 默认身份：读 LIRI_DATA_DIR
    expect(resolveDbPath(env('LIRI_DATA_DIR'))).toContain('kernel-test-home');

    configureProductIdentity({ envPrefix: 'ACME' });
    try {
      // 旧前缀不再生效；新前缀生效（`ACME` 自动补成 `ACME_`）
      expect(resolveDbPath(env('LIRI_DATA_DIR'))).not.toContain(
        'kernel-test-home'
      );
      expect(resolveDbPath(env('ACME_DATA_DIR'))).toContain('kernel-test-home');
    } finally {
      resetProductIdentity();
    }

    expect(resolveDbPath(env('LIRI_DATA_DIR'))).toContain('kernel-test-home');
  });
});
