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
 * A4（2026-09-26，《Liri 优化方案》）：起始态必失败校验 —— **按断言极性分流**。
 *
 * 覆盖方案 §1.1 #11/#12 的核心：`positive` fail-closed、`negative` **必须跳过**
 * （否则当场废掉 7 条 attack 题），以及"assert 抛错不得被当成断言失败放行"。
 */
import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  checkInitialState,
  judgeInitialState,
} from '../../src/evals/initialStateCheck';
import type { EvalTask } from '../../src/evals/types';

function makeCtxDirs() {
  const root = mkdtempSync(join(tmpdir(), 'a4-init-'));
  const dirs = {
    workspace: join(root, 'workspace'),
    home: join(root, 'home'),
    dataDir: join(root, 'data'),
  };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });
  return { root, dirs };
}

function taskOf(
  overrides: Partial<EvalTask> & Pick<EvalTask, 'assertionPolarity' | 'assert'>
): EvalTask {
  return {
    id: 'a4-task',
    name: 'A4 用例题',
    level: 'L1',
    prompt: () => '',
    ...overrides,
  };
}

describe('A4: judgeInitialState（纯判据）', () => {
  it('positive + 起始态断言失败 ⇒ 通过（fail-closed 满足）', () => {
    const v = judgeInitialState('t', 'positive', false, 'eval_out/hello.txt 未创建');
    expect(v.checked).toBe(true);
    expect(v.ok).toBe(true);
    expect(v.detail).toContain('按预期失败');
  });

  it('positive + 起始态断言**通过** ⇒ 不通过（断言区分不出"做了/没做"，任务无效）', () => {
    const v = judgeInitialState('t', 'positive', true);
    expect(v.checked).toBe(true);
    expect(v.ok).toBe(false);
    expect(v.detail).toContain('任务无效');
  });

  it('negative ⇒ **跳过**校验（否则会误杀 7 条 attack 题）', () => {
    const v = judgeInitialState('t', 'negative', false);
    expect(v.checked).toBe(false);
    expect(v.ok).toBe(true);
    expect(v.detail).toContain('跳过');
  });
});

describe('A4: checkInitialState（零动作上下文跑 setup+assert）', () => {
  it('positive 题：起始态断言通过 ⇒ 判失败', async () => {
    const { root, dirs } = makeCtxDirs();
    try {
      const task = taskOf({
        assertionPolarity: 'positive',
        assert: async () => ({ pass: true }),
      });
      const v = await checkInitialState(task, dirs);
      expect(v.ok).toBe(false);
      expect(v.initialPass).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('positive 题：起始态断言失败 ⇒ 判通过', async () => {
    const { root, dirs } = makeCtxDirs();
    try {
      const task = taskOf({
        assertionPolarity: 'positive',
        assert: async () => ({ pass: false, reason: '产物未创建' }),
      });
      const v = await checkInitialState(task, dirs);
      expect(v.ok).toBe(true);
      expect(v.initialPass).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('negative 题：**不执行** assert（用一个必抛的 assert 证明被跳过）', async () => {
    const { root, dirs } = makeCtxDirs();
    try {
      let called = 0;
      const task = taskOf({
        assertionPolarity: 'negative',
        assert: async () => {
          called += 1;
          throw new Error('不该被调用');
        },
      });
      const v = await checkInitialState(task, dirs);
      expect(called).toBe(0);
      expect(v.checked).toBe(false);
      expect(v.ok).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('positive 题：assert **抛错** ⇒ fail-closed（不当成"断言失败"放行）', async () => {
    const { root, dirs } = makeCtxDirs();
    try {
      const task = taskOf({
        assertionPolarity: 'positive',
        assert: async () => {
          throw new Error('断言自身有缺陷');
        },
      });
      const v = await checkInitialState(task, dirs);
      expect(v.ok).toBe(false);
      expect(v.detail).toContain('抛错');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('零动作上下文：finalText 为空、toolCalls 为空（不调模型）', async () => {
    const { root, dirs } = makeCtxDirs();
    try {
      let seenFinalText: string | undefined;
      let seenToolCalls: unknown[] | undefined;
      const task = taskOf({
        assertionPolarity: 'positive',
        assert: async (ctx) => {
          seenFinalText = ctx.finalText;
          seenToolCalls = ctx.toolCalls;
          return { pass: false };
        },
      });
      await checkInitialState(task, dirs);
      expect(seenFinalText).toBe('');
      expect(seenToolCalls).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
