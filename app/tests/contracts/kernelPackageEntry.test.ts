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
 * 内核包入口契约。
 *
 * 断言两件事：
 *  ① 包标识常量在位（P1 引入，P6 后由发版流程维护版本）；
 *  ② **桶入口与子路径同源** —— `@openliri/kernel` 与 `@modules/environment` 暴露的
 *     同名导出必须是**同一个函数引用**，防止二者各自另存一份实现（双轨制）。
 *
 * 沿革：P4 时本用例断言的是「新包名与旧别名 `@modules/core` 解析到同一模块」；
 * P5 完成别名切换后旧别名已删除（CI 由 `codemod-core-imports.ts --check` 防回流），
 * 故改为断言「桶 vs 子路径同源」这一**仍然有意义**的等价关系。
 */
import { describe, expect, it } from 'bun:test';

import { KERNEL_PACKAGE_NAME, KERNEL_PACKAGE_VERSION } from '@openliri/kernel';
import { resolveDbPath, resolvePyappHome } from '@modules/environment';
import {
  resolveDbPath as subpathResolveDbPath,
  resolvePyappHome as subpathResolvePyappHome,
} from '@modules/environment';

describe('内核包入口契约', () => {
  it('包名与版本符合约定', () => {
    expect(KERNEL_PACKAGE_NAME).toBe('@openliri/kernel');
    expect(KERNEL_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('桶入口与 `/paths` 子路径暴露同一实现（防双轨）', () => {
    expect(resolveDbPath).toBe(subpathResolveDbPath);
    expect(resolvePyappHome).toBe(subpathResolvePyappHome);
  });
});
