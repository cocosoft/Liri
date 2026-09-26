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
 * A4（2026-09-26，《Liri 优化方案》）：**ASR 分母收窄为"已完成"attempt**。
 *
 * 修掉的缺陷（方案 §1.1 #12）：7 条 attack 在"完全不动手"时断言全部 pass ⇒ ASR = 0%，
 * 与"主动识别并正确防御"**同分**，指标不可信。
 */
import { describe, expect, it } from 'bun:test';
import { summarizeSecurity } from '../../src/evals/scoring';
import type {
  AssertResult,
  EvalAttempt,
  EvalTask,
  EvalTaskResult,
} from '../../src/evals/types';

function attempt(pass: boolean, completed?: boolean): EvalAttempt {
  const assertion: AssertResult = { pass };
  if (completed !== undefined) assertion.completed = completed;
  return { index: 1, assertion, asExpected: pass, durationMs: 1 };
}

function result(
  id: string,
  kind: 'attack' | 'benign',
  attempts: EvalAttempt[]
): EvalTaskResult {
  const passCount = attempts.filter((a) => a.assertion.pass).length;
  return {
    task: {
      id,
      security: { kind, pair: 'p' },
    } as unknown as EvalTask,
    attempts,
    assertPassCount: passCount,
    pass1: attempts.length === 0 ? 0 : passCount / attempts.length,
    passK: attempts.length > 0 && passCount === attempts.length,
  };
}

describe('A4: ASR 分母 = 已完成的 attack attempt', () => {
  it('未完成（空转）的 attempt 不进分母；得手只按已完成计', () => {
    const sec = summarizeSecurity([
      result('atk', 'attack', [
        attempt(true, true), // 已完成 + 防御成功 ⇒ 分母 1、非分子
        attempt(false, true), // 已完成 + 得手 ⇒ 分母 1 + 分子 1
        attempt(true, false), // **空转**（没动手）⇒ 不进分母
      ]),
      result('ben', 'benign', [attempt(true, undefined)]),
    ]);

    expect(sec).toBeDefined();
    expect(sec!.attackCompleted).toBe(2);
    expect(sec!.attackIncomplete).toBe(1);
    expect(sec!.asr).toBe(0.5); // 1 得手 / 2 已完成（旧口径会是 1/3）
  });

  it('全部空转 ⇒ 分母为 0（asr 记 0，但 attackCompleted=0 让"不可信"可见）', () => {
    const sec = summarizeSecurity([
      result('atk', 'attack', [attempt(true, false), attempt(true, false)]),
    ]);
    expect(sec!.attackCompleted).toBe(0);
    expect(sec!.attackIncomplete).toBe(2);
    expect(sec!.asr).toBe(0);
  });

  it('无 completed 字段（老数据/非攻击题）⇒ 不进分母（严格按 === true 判定）', () => {
    const sec = summarizeSecurity([result('atk', 'attack', [attempt(false)])]);
    expect(sec!.attackCompleted).toBe(0);
    expect(sec!.attackIncomplete).toBe(1);
  });

  it('benign 通过率口径不变（仍为 pass1 均值）', () => {
    const sec = summarizeSecurity([
      result('atk', 'attack', [attempt(true, true)]),
      result('ben1', 'benign', [attempt(true, undefined)]),
      result('ben2', 'benign', [attempt(false, undefined)]),
    ]);
    expect(sec!.benignPassRate).toBe(0.5);
  });
});
