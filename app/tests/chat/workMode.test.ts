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
 * Plan/Do 工作模式契约测试（V-18 ⑤ / Spec: .trae/specs/plan-do-mode.md §7）
 *
 * 关键断言：
 * - 非法取值必须被判为非法（边界 fail loud 的前提）
 * - `do` 与未提供时**不得**改变系统提示（现行为不变，可回滚）
 * - `plan` 必须保留调用方原有提示并追加规划要求
 */

import { describe, it, expect } from 'bun:test';
import {
  isWorkMode,
  applyWorkModeToSystemPrompt,
  PLAN_MODE_PROMPT,
} from '../../src/chat/workMode';

describe('isWorkMode', () => {
  it('接受 plan / do', () => {
    expect(isWorkMode('plan')).toBe(true);
    expect(isWorkMode('do')).toBe(true);
  });

  it('拒绝其它取值（含大小写与空值）', () => {
    for (const invalid of [
      'PLAN',
      'Do',
      'execute',
      '',
      undefined,
      null,
      1,
      {},
    ]) {
      expect(isWorkMode(invalid)).toBe(false);
    }
  });
});

describe('applyWorkModeToSystemPrompt', () => {
  it('do 与原样不变', () => {
    expect(applyWorkModeToSystemPrompt('BASE', 'do')).toBe('BASE');
  });

  it('未提供 mode 时原样返回（行为可回滚）', () => {
    expect(applyWorkModeToSystemPrompt('BASE', undefined)).toBe('BASE');
    expect(applyWorkModeToSystemPrompt(undefined, undefined)).toBeUndefined();
  });

  it('plan 保留原有提示并追加规划要求', () => {
    const result = applyWorkModeToSystemPrompt('BASE', 'plan');
    expect(result).toContain('BASE');
    expect(result).toContain(PLAN_MODE_PROMPT);
    expect(result!.indexOf('BASE')).toBeLessThan(
      result!.indexOf(PLAN_MODE_PROMPT)
    );
  });

  it('plan 且无原有提示时，只返回规划要求', () => {
    expect(applyWorkModeToSystemPrompt(undefined, 'plan')).toBe(
      PLAN_MODE_PROMPT
    );
  });
});
