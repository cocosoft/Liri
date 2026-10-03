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
 * A2（2026-09-26，《Liri 优化方案》）：行为指标三个子指标的边界回归。
 *
 * 方案 A2 点名的 4 个边界：**无编辑 / 编辑后无验证 / 重复命令只算一次 / 不同命令累加**；
 * 另覆盖 ② 的"编辑前"切分与 ③ 的除零。纯函数、无沙箱与网络依赖。
 *
 * ⚠️ 三个指标**仅观测**，本文件同时反向锁定"不进 `isAsExpected`"这一取向（见末例）。
 */
import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  computeBehaviorMetrics,
  countExploration,
  countSelfVerification,
  draftingRatio,
} from '../../src/evals/behaviorMetrics';
import { writeReport } from '../../src/evals/report';
import { isAsExpected } from '../../src/evals/scoring';
import type {
  EvalRunSummary,
  EvalTask,
  EvalTaskResult,
  ToolCallRecord,
} from '../../src/evals/types';

function call(name: string, args?: Record<string, unknown>): ToolCallRecord {
  return { name, args };
}

function bash(command: string): ToolCallRecord {
  return call('bash', { command });
}

describe('A2 ① countSelfVerification：以首个编辑为界', () => {
  it('边界 1：无编辑 ⇒ 0', () => {
    expect(
      countSelfVerification([
        call('file_read', { file_path: '/w/a' }),
        bash('npm test'),
      ])
    ).toBe(0);
  });

  it('边界 2：编辑后无验证命令 ⇒ 0', () => {
    expect(
      countSelfVerification([
        call('file_read', { file_path: '/w/a' }),
        call('file_write', { file_path: '/w/a', content: 'x' }),
        call('file_read', { file_path: '/w/a' }),
      ])
    ).toBe(0);
  });

  it('边界 3：重复命令只算一次（含跨工具等价与空白差异归一）', () => {
    expect(
      countSelfVerification([
        call('file_edit', { file_path: '/w/a' }),
        bash('npm test'),
        bash('npm  test'), // 空白差异 ⇒ 归一后视为同一命令
        call('code_run', { command: 'npm test' }), // 经不同工具发出的等价命令 ⇒ 按重复计
      ])
    ).toBe(1);
  });

  it('边界 4：不同命令累加', () => {
    expect(
      countSelfVerification([
        call('file_write', { file_path: '/w/a' }),
        bash('npm test'),
        bash('npm run lint'),
      ])
    ).toBe(2);
  });

  it('编辑**之前**的命令不计入（只统计"其后的独立验证"）', () => {
    expect(
      countSelfVerification([
        bash('npm test'),
        call('file_write', { file_path: '/w/a' }),
      ])
    ).toBe(0);
  });

  it('非字符串 / 空命令 ⇒ 忽略（不抛错）', () => {
    expect(
      countSelfVerification([
        call('file_write', { file_path: '/w/a' }),
        call('bash', { command: '   ' }),
        call('bash', { command: 42 }),
        call('bash', {}),
      ])
    ).toBe(0);
  });
});

describe('A2 ② countExploration：首个编辑之前', () => {
  it('编辑前的读/搜计入，编辑后的不计', () => {
    expect(
      countExploration([
        call('file_read', { file_path: '/w/a' }),
        call('grep', { pattern: 'foo' }),
        call('glob', { pattern: '**/*.ts' }),
        call('file_write', { file_path: '/w/a' }),
        call('file_read', { file_path: '/w/b' }), // 编辑后 ⇒ 不计
      ])
    ).toBe(3);
  });

  it('全程无编辑 ⇒ 计全部读/搜', () => {
    expect(
      countExploration([
        call('file_read'),
        call('grep'),
        call('bash', { command: 'ls' }),
      ])
    ).toBe(2);
  });

  it('非读/搜工具不计（bash / file_write）', () => {
    expect(
      countExploration([bash('ls'), call('file_write', { file_path: '/w/a' })])
    ).toBe(0);
  });
});

describe('A2 ③ draftingRatio', () => {
  it('无工具调用 ⇒ 0（不除零）', () => {
    expect(draftingRatio('一些草稿文本', 0)).toBe(0);
  });

  it('比值 = 正文长度 ÷ 工具调用数（保留 2 位）', () => {
    expect(draftingRatio('x'.repeat(100), 4)).toBe(25);
    expect(draftingRatio('x'.repeat(10), 3)).toBe(3.33);
  });
});

describe('A2 computeBehaviorMetrics：结构稳定 + 不进门禁', () => {
  it('三字段齐备且与单项函数一致', () => {
    const calls = [
      call('file_read', { file_path: '/w/a' }),
      call('file_write', { file_path: '/w/a', content: 'y'.repeat(50) }),
      bash('npm test'),
    ];
    const m = computeBehaviorMetrics(calls, 'y'.repeat(50));
    expect(m).toEqual({
      selfVerificationCount: countSelfVerification(calls),
      explorationCount: countExploration(calls),
      draftingRatio: draftingRatio('y'.repeat(50), calls.length),
    });
    expect(m.explorationCount).toBe(1);
    expect(m.selfVerificationCount).toBe(1);
  });

  it('反向锁定：行为指标**不参与** asExpected 判定（方案 A2 明文"不得作为门禁"）', () => {
    const task = {
      id: 't',
      name: 't',
      level: 'L1',
      prompt: () => '',
      expect: 'pass',
      assert: async () => ({ pass: true }),
    } as unknown as EvalTask;
    // asExpected 只看 assertion.pass 与 task.expect；行为指标再多也不改变结论
    expect(isAsExpected(task, { pass: true })).toBe(true);
    expect(isAsExpected(task, { pass: false })).toBe(false);
  });

  it('落盘可见性（不跑真实模型）：behavior 与 toolCallsDetail 均进入 JSON，MD 出现三指标', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-report-'));
    try {
      const calls = [
        call('file_read', { file_path: '/w/a' }),
        call('file_write', { file_path: '/w/a', content: 'x' }),
        bash('npm test'),
      ];
      const task = {
        id: 'unit-A1A2',
        name: '报告落盘可见性',
        level: 'L2',
        prompt: () => '',
        expect: 'pass',
        assert: async () => ({ pass: true }),
      } as unknown as EvalTask;
      const attempt = {
        index: 1,
        assertion: { pass: true },
        asExpected: true,
        durationMs: 1,
        toolCalls: ['file_read', 'file_write', 'bash'],
        toolCallsDetail: [{ name: 'file_read', args: { file_path: '/w/a' } }],
        behavior: computeBehaviorMetrics(calls, 'x'.repeat(30)),
      };
      const taskResult: EvalTaskResult = {
        task,
        attempts: [attempt],
        assertPassCount: 1,
        pass1: 1,
        passK: true,
      };
      const summary = {
        startedAt: '2026-09-26T00:00:00.000Z',
        finishedAt: '2026-09-26T00:00:01.000Z',
        model: 'unit-model',
        k: 1,
        tasks: [taskResult],
        passKRate: 1,
        pass1Mean: 1,
        judgeSanityOk: true,
      } as unknown as EvalRunSummary;

      const { jsonPath, mdPath } = writeReport(summary, dir);

      // A1：明细进 JSON（报告可离线重算）
      const json = JSON.parse(readFileSync(jsonPath, 'utf-8')) as {
        tasks: Array<{
          attempts: Array<{
            toolCallsDetail?: unknown;
            behavior?: { selfVerificationCount?: number };
          }>;
        }>;
      };
      const persisted = json.tasks[0].attempts[0];
      expect(persisted.toolCallsDetail).toEqual([
        { name: 'file_read', args: { file_path: '/w/a' } },
      ]);
      // A2：三个字段进 JSON
      expect(persisted.behavior?.selfVerificationCount).toBe(1);

      // A2：三个字段在 MD 报告里出现（人可读）
      const md = readFileSync(mdPath, 'utf-8');
      expect(md).toContain('行为: 自验证1/探索1/草稿比10');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
