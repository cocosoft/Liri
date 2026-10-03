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
 * A7：已登记**任务源规格**的防漂移守卫（12 条）。
 *
 * 计数沿革：第二批 10 条 + 第三批 3 条 = 13 条；2026-10-02（D-237）**废弃 1 条**
 * `src-dedupe-tool-call-blocks` —— 其源文件 `chatBlocks.ts` 经分层治理下沉至 `app/src/utils/`，
 * 已落在 `DEFAULT_SOURCE_DIRS`（`app/src/{chat,query,tools}`）之外 ⇒ 规格前提消失（详见 spec
 * `pending` 记录与 `dev_docs/error_repairs/预存错误与待处理问题.md` D-237）。
 *
 * 为什么需要：规格里写的是**仓库内文件路径 + 导出名**，一旦源文件被移动/改名/加运行时 import，
 * 流水线会在下次干跑时 `rejected`——但那只在"有人手动跑 CLI"时才暴露。本用例把同一批约束
 * 前移到全量门禁：**复用流水线自己的判据**（`discoverSourceCandidates` 的资格线 +
 * `stubFromSource` 的机械签名规则），不另写一套正则。
 *
 * 注意：这里**不重跑 10 条的真实执行自检**（那要 ~20 次子进程，属"重活"）——真实执行判定
 * 由 CLI 干跑 `--list-source-tasks` 承担；本用例保证"规格指向的目标仍然存在且仍合格"。
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  discoverSourceCandidates,
  resolveEvalRepoRoot,
  stubFromSource,
} from '../../src/evals/sourceTask';
import { sourceTaskSpecs } from '../../src/evals/tasks/source-derived';

const repoRoot = resolveEvalRepoRoot();

describe('A7 任务源规格（12 条）：结构与资格线防漂移', () => {
  test('规格数量与唯一 id（第二批 10 条 + 第三批 3 条 − 已废弃 1 条 = 12 条）', () => {
    expect(sourceTaskSpecs.length).toBe(12);
    const ids = sourceTaskSpecs.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('每条规格都指向**仍合格**的候选（零运行时 import + 导出名仍在）', () => {
    // 复用流水线的候选发现（资格线 = 零运行时 import）——不另写判据
    const candidates = new Map(
      discoverSourceCandidates(repoRoot).map((c) => [c.path, c.exports])
    );
    for (const spec of sourceTaskSpecs) {
      const exports = candidates.get(spec.sourcePath);
      expect(
        exports,
        `${spec.id} 的源文件不再满足资格线（未出现在候选清单）：${spec.sourcePath}`
      ).toBeDefined();
      expect(
        exports?.includes(spec.exportName),
        `${spec.id} 的导出名已漂移：${spec.sourcePath} 不含 ${spec.exportName}`
      ).toBe(true);
    }
  });

  test('每条规格的桩都能由签名机械生成（否则流水线会 rejected）', () => {
    for (const spec of sourceTaskSpecs) {
      const source = readFileSync(resolve(repoRoot, spec.sourcePath), 'utf-8');
      const stub = stubFromSource(source, spec.exportName);
      expect(stub, `${spec.id} 无法机械提取签名`).not.toBeNull();
      expect(stub).toContain(`export function ${spec.exportName}`);
      expect(stub).toContain('Not implemented');
    }
  });

  test('每条规格都有可观察行为描述与多条用例（用例只给输入）', () => {
    for (const spec of sourceTaskSpecs) {
      expect(
        spec.behavior.length,
        `${spec.id} 缺行为描述`
      ).toBeGreaterThanOrEqual(3);
      expect(spec.cases.length, `${spec.id} 用例过少`).toBeGreaterThanOrEqual(
        4
      );
      for (const c of spec.cases) {
        expect(c.name.length, `${spec.id} 存在无用例名的用例`).toBeGreaterThan(
          0
        );
        expect(
          Array.isArray(c.args),
          `${spec.id}/${c.name} args 必须是数组`
        ).toBe(true);
        // 期望值一律由真实执行捕获 ⇒ 规格里**不得**出现 value/expected 字段
        expect(
          Object.prototype.hasOwnProperty.call(c, 'value'),
          `${spec.id}/${c.name} 手写了期望值（违反 CS04：期望值必须实测）`
        ).toBe(false);
      }
    }
  });

  test('用例总量可控（执行器内联 JSON，命令行有 28k 上限）', () => {
    const total = sourceTaskSpecs.reduce((n, s) => n + s.cases.length, 0);
    expect(total).toBeGreaterThanOrEqual(40);
    expect(total).toBeLessThanOrEqual(120);
  });
});
