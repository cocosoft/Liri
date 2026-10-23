// MIT License
// Copyright (c) 2026 Liri
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
 * P4 契约：`@openliri/kernel` 与遗留别名 `@modules/core` **解析到同一份实现**。
 *
 * 为什么需要这条断言（复审 R7）：`tsc` 与 `bun` 是两套解析器，别名一旦只改了一边，
 * 就会出现「typecheck 绿、运行时找不到模块」或反之。P5 会把 `@modules/core` 整体切到
 * `@openliri/kernel`（codemod），切换期间两个别名并存 —— 这里用**导出引用同一性**
 * 直接钉住「并存期它们确实是同一个模块实例」，而不是两条互不相干的路径各自能加载。
 */
import { describe, expect, it } from 'bun:test';

import { KERNEL_PACKAGE_NAME, KERNEL_PACKAGE_VERSION } from '@openliri/kernel';
import * as viaKernel from '@openliri/kernel/paths';
import * as viaLegacyAlias from '@openliri/kernel/paths';

describe('P4 契约：内核包名与遗留别名同源', () => {
  it('包名与版本符合约定', () => {
    expect(KERNEL_PACKAGE_NAME).toBe('@openliri/kernel');
    expect(KERNEL_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('`@openliri/kernel/paths` 与 `@modules/core/paths` 是同一个模块实例', () => {
    expect(viaKernel.resolveDbPath).toBe(viaLegacyAlias.resolveDbPath);
    expect(viaKernel.resolvePyappHome).toBe(viaLegacyAlias.resolvePyappHome);
  });
});
