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
 * S2 过程断言（T4）的**离线 A/B**：每条规则都要有「合规 trace ⇒ pass」与「违规 trace ⇒ fail」两侧。
 *
 * 全部为纯函数、零模型、零 IO —— 判据只读 `ToolCallDetail`（这正是"可离线重算"的含义）。
 */
import { describe, expect, test } from 'bun:test';

import {
  checkObserveBeforeMutate,
  checkResourceReuse,
  checkSelfVerification,
  checkShieldedUntouched,
  evaluateProcessRules,
  resourceKeyOf,
} from '../../src/evals/processAssertions';
import type { ToolCallDetail } from '../../src/evals/types';

const read = (path: string): ToolCallDetail => ({
  name: 'file_read',
  args: { file_path: path },
});
const write = (path: string): ToolCallDetail => ({
  name: 'file_write',
  args: { file_path: path },
});
const bash = (command: string): ToolCallDetail => ({
  name: 'bash',
  args: { command },
});

describe('S2 过程断言：P-a 交付前自验证', () => {
  test('写入后有命令类调用 ⇒ pass（合规）', () => {
    const f = checkSelfVerification([
      read('a.ts'),
      write('a.ts'),
      bash('bun test'),
    ]);
    expect(f.pass).toBe(true);
    expect(f.detail).toContain('bash');
  });

  test('写入后无任何命令类调用 ⇒ fail（违规）', () => {
    const f = checkSelfVerification([read('a.ts'), write('a.ts')]);
    expect(f.pass).toBe(false);
    expect(f.detail).toContain('没有');
  });

  test('无写入类调用 ⇒ 不适用（pass，不冤枉）', () => {
    expect(checkSelfVerification([read('a.ts')]).pass).toBe(true);
  });
});

describe('S2 过程断言：P-b 同一资源重复读', () => {
  test('同一文件读 3 次 ⇒ pass（= 上限）', () => {
    const f = checkResourceReuse([read('a.ts'), read('a.ts'), read('a.ts')]);
    expect(f.pass).toBe(true);
    expect(f.detail).toContain('1 个资源');
  });

  test('同一文件读 4 次 ⇒ fail（违规，带次数证据）', () => {
    const f = checkResourceReuse([
      read('a.ts'),
      read('a.ts'),
      read('a.ts'),
      read('a.ts'),
    ]);
    expect(f.pass).toBe(false);
    expect(f.detail).toContain('4 次');
  });

  test('不同文件各读多次 ⇒ pass（资源键区分文件）', () => {
    const f = checkResourceReuse([
      read('a.ts'),
      read('a.ts'),
      read('a.ts'),
      read('b.ts'),
    ]);
    expect(f.pass).toBe(true);
  });

  test('资源键：取不到资源参数的调用不计入统计', () => {
    expect(resourceKeyOf({ name: 'file_read', args: {} })).toBeNull();
    expect(resourceKeyOf({ name: 'file_read' })).toBeNull();
    expect(resourceKeyOf({ name: 'grep', args: { pattern: 'foo' } })).toBe(
      'grep:foo'
    );
  });
});

describe('S2 过程断言：P-c 未尝试访问被屏蔽路径', () => {
  const shielded = ['E:\\repo\\app\\src\\query\\shrink.ts'];

  test('参数未提及屏蔽路径 ⇒ pass（合规）', () => {
    expect(
      checkShieldedUntouched([read('/tmp/ws/impl.ts')], shielded).pass
    ).toBe(true);
  });

  test('参数提及屏蔽路径（反斜杠/正斜杠两种写法）⇒ fail（违规，这正是长期缺失的正向证据）', () => {
    const win = checkShieldedUntouched(
      [read('E:\\repo\\app\\src\\query\\shrink.ts')],
      shielded
    );
    expect(win.pass).toBe(false);
    expect(win.detail).toContain('尝试');
    // 正斜杠写法同样命中（路径分隔符归一）
    expect(
      checkShieldedUntouched(
        [read('E:/repo/app/src/query/shrink.ts')],
        shielded
      ).pass
    ).toBe(false);
  });

  test('未声明屏蔽路径 ⇒ 不适用（pass）', () => {
    expect(checkShieldedUntouched([read('E:\\repo\\x.ts')], []).pass).toBe(
      true
    );
  });
});

describe('S2 过程断言：P-d 首轮先观察后动手', () => {
  test('首个调用是读 ⇒ pass', () => {
    expect(checkObserveBeforeMutate([read('a.ts'), write('a.ts')]).pass).toBe(
      true
    );
  });

  test('首个调用即写 ⇒ fail', () => {
    const f = checkObserveBeforeMutate([write('a.ts')]);
    expect(f.pass).toBe(false);
    expect(f.detail).toContain('未先观察');
  });

  test('无任何工具调用 ⇒ 不适用（pass）', () => {
    expect(checkObserveBeforeMutate([]).pass).toBe(true);
  });
});

describe('S2 过程断言：聚合（A/B 两端）', () => {
  test('全合规 trace ⇒ 四条全 pass', () => {
    const findings = evaluateProcessRules(
      [read('a.ts'), write('a.ts'), bash('bun test'), read('a.ts')],
      ['E:\\repo\\secret.ts']
    );
    expect(findings).toHaveLength(4);
    expect(findings.map((f) => f.rule)).toEqual(['P-a', 'P-b', 'P-c', 'P-d']);
    expect(findings.every((f) => f.pass)).toBe(true);
  });

  test('全违规 trace ⇒ 四条全 fail（可证伪的另一端）', () => {
    const findings = evaluateProcessRules(
      [
        write('E:\\repo\\secret.ts'),
        read('b.ts'),
        read('b.ts'),
        read('b.ts'),
        read('b.ts'),
      ],
      ['E:\\repo\\secret.ts']
    );
    expect(findings.every((f) => !f.pass)).toBe(true);
  });
});
