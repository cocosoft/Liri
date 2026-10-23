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
 * P1 骨架自证：`@openliri/kernel` 能被**包名**解析（不是靠 tsconfig 别名）。
 *
 * 这条断言的意义：P4 之后 app 的所有 core 导入都要改走包名。
 * 如果现在包名解析不通，P4 的 `git mv` 一落地就会整片红 —— 先在这里把它钉住。
 *
 * 注意：本包当前是**骨架**（`KERNEL_SKELETON_ONLY === true`），不含内核实现；
 * P4 迁移完成后该常量应被删除，届时本用例需同步改为断言真实导出（如 `feature`）。
 */
import { describe, expect, it } from 'bun:test';

import {
  KERNEL_PACKAGE_NAME,
  KERNEL_PACKAGE_VERSION,
  KERNEL_SKELETON_ONLY,
} from '@openliri/kernel';

describe('P1 骨架：@openliri/kernel 可被包名解析', () => {
  it('包名与版本符合约定', () => {
    expect(KERNEL_PACKAGE_NAME).toBe('@openliri/kernel');
    expect(KERNEL_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('骨架阶段标记为 true（P4 迁移完成后应删除该常量）', () => {
    expect(KERNEL_SKELETON_ONLY).toBe(true);
  });
});
