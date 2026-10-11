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
 * G8（2026-10-11，S2-3）—— **转发 shim 一致性守卫**。
 *
 * 背景：`src/tools/types/*` 是 `B1 8-b`（方案甲）保留下来的**转发**文件（原址 → `utils/toolContract/`），
 * 目的仅是让 `tools/**` 内约 230 处相对引用零改动。若有人**就地**在其中补声明/改实现，
 * 会静默形成**双轨**（转发面与落点同形不同物，改一处另一处不生效）—— 全仓原有守卫**不覆盖**此风险。
 *
 * 本守卫把"这些文件**只能** re-export"变成 **CI 可失败**：
 *  - 每个 shim 代码行必须形如 `export * from '…'`；
 *  - 桶文件 `index.ts` 额外允许纯类型转发 `export type { X } from '…'`；
 *  - 任何 `export const/function/class/interface/type X = …`（就地声明）⇒ 失败。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';

const DIR = join(import.meta.dir, '../../src/tools/types');

/** 去掉块注释 / 行注释 / 空行，仅保留代码行（守卫只看语义行，不受文档注释影响） */
function codeLines(src: string): string[] {
  const withoutBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutBlock
    .split('\n')
    .map((l) => l.replace(/\/\/.*$/, '').trim())
    .filter((l) => l.length > 0);
}

/** 判据（纯函数，供真实扫描与**负向自证**共用）：返回违规代码行 */
function findShimOffenders(src: string): string[] {
  return codeLines(src).filter(
    (l) =>
      !/^export \* from /.test(l) && !/^export type \{[^}]*\} from /.test(l)
  );
}

describe('G8 转发 shim 守卫：tools/types/* 只能 re-export（不得就地声明）', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.ts'));

  it('目录内存在 shim 文件（防扫描失效导致守卫恒真）', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('门禁自证（负向夹具）：就地声明会被判违规 ⇒ 守卫非恒真', () => {
    const bad =
      "export * from './x';\n" +
      "export const NAME = 'y';\n" +
      'export function f() {}\n' +
      'export type Z = number;\n';
    const offenders = findShimOffenders(bad);
    expect(offenders).toEqual([
      "export const NAME = 'y';",
      'export function f() {}',
      'export type Z = number;',
    ]);
  });

  for (const file of files) {
    it(`${file} 仅含 re-export（无就地声明）`, () => {
      const offenders = findShimOffenders(
        readFileSync(join(DIR, file), 'utf-8')
      );
      expect({ file, offenders }).toEqual({ file, offenders: [] });
    });
  }
});
