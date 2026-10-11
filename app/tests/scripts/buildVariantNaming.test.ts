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
 * G2（2026-10-11，S3-1）—— `build-variant.ts` **正名守卫**。
 *
 * 该脚本**只**生成 `BUILD_VARIANT_FLAGS`（+ enterprise 模板复制），**不做编译**；
 * 原输出宣称"执行 TypeScript 编译…/构建完成/输出目录 dist/"名不副实 ⇒ 逐字订正。
 * 本守卫锁死"误导文案不得回流"（只看**代码**，注释中的引述不计）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';

const SRC = join(import.meta.dir, '../../scripts/build-variant.ts');

/** 去块注释 / 行注释（守卫只看**代码**，不受文档注释中的引述影响） */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** 判据（纯函数，供真实检查与**负向自证**共用）：返回代码中仍残留的"名不副实"宣称 */
const MISLEADING_PHRASES = ['执行 TypeScript 编译', '构建完成'] as const;
function findMisleadingClaims(code: string): string[] {
  return MISLEADING_PHRASES.filter((p) => code.includes(p));
}

describe('G2 build-variant 正名（防误导文案回流）', () => {
  const code = stripComments(readFileSync(SRC, 'utf-8'));

  it('门禁自证（负向夹具）：含误导宣称的代码会被判违规 ⇒ 守卫非恒真', () => {
    const bad = stripComments(
      "console.log('执行 TypeScript 编译...');\nconsole.log('构建完成！');\n"
    );
    expect(findMisleadingClaims(bad)).toEqual([
      '执行 TypeScript 编译',
      '构建完成',
    ]);
  });

  it('代码中不再出现"执行 TypeScript 编译" / "构建完成"的宣称', () => {
    expect(findMisleadingClaims(code)).toEqual([]);
  });

  it('显式声明"不做 TypeScript 编译 / 打包"', () => {
    expect(code).toContain('不做 TypeScript 编译');
  });
});
