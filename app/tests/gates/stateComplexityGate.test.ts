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

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Linter } from 'eslint';

/**
 * R10 状态复杂度门禁 —— **控制样例（自证）**。
 *
 * 目的（对齐 R5/R8 的教训：**防"门禁写错 ⇒ 空转通过"**）：
 *   ① 断言**真实** `eslint.config.js` 确实启用 `complexity`（warn + 整数阈值）—— 配置自省；
 *   ② 用**真实阈值**对"合成违规样例（复杂度 > 阈值）"断言规则**真的报错**；
 *   ③ 成对反证：低复杂度样例**不报**（防"恒报"假绿）。
 *
 * 说明：用 ESLint `Linter`（同步、无磁盘 IO）+ 与真实配置**同值**的阈值，避免加载 `.js`
 * 配置（仓内 `tsconfig` 未开 `allowJs`）。阈值取自配置文本，二者若漂移，本测试的匹配会失败。
 */
const APP_DIR = resolve(import.meta.dir, '..', '..');
const CONFIG_PATH = resolve(APP_DIR, 'eslint.config.js');

/** 从真实 eslint.config.js 抽取 complexity 规则（level + 阈值）。 */
function realComplexityRule(): { level: string; value: number } | null {
  const text = readFileSync(CONFIG_PATH, 'utf-8');
  // 匹配 `complexity: ['warn', 40]`
  const m = /complexity:\s*\[\s*'(\w+)'\s*,\s*(\d+)\s*\]/.exec(text);
  return m ? { level: m[1], value: parseInt(m[2], 10) } : null;
}

/** 用给定阈值跑 ESLint 内置 `complexity` 规则，返回命中的规则 id 列表。 */
function lintComplexity(code: string, threshold: number): string[] {
  const linter = new Linter();
  const messages = linter.verify(code, {
    rules: { complexity: ['warn', threshold] },
  });
  return messages
    .map((m) => m.ruleId)
    .filter((id): id is string => id !== null);
}

/** 合成一个复杂度 = 1 + n 的函数（每个 if 记 1 分）。 */
function synth(n: number): string {
  const branches = Array.from(
    { length: n },
    (_, i) => `if (x === ${i}) return ${i};`
  ).join('');
  return `function f(x) {${branches}return -1;}`;
}

describe('R10 状态复杂度门禁 · 控制样例', () => {
  it('G1 真实配置启用了 complexity（warn + 整数阈值）', () => {
    const rule = realComplexityRule();
    expect(rule).not.toBeNull();
    expect(rule?.level).toBe('warn');
    expect(Number.isInteger(rule?.value)).toBe(true);
    expect((rule?.value ?? 0) > 0).toBe(true);
  });

  it('G2 合成超阈值样例 ⇒ 规则真的报 complexity（控制样例）', () => {
    const rule = realComplexityRule();
    if (!rule) throw new Error('未在 eslint.config.js 找到 complexity 规则');
    // 复杂度 = 1 + (阈值 + 5) ⇒ 必超阈值
    const violations = lintComplexity(synth(rule.value + 5), rule.value);
    expect(violations).toContain('complexity');
  });

  it('G3 成对反证：低复杂度样例 ⇒ 不报（防"恒报"假绿）', () => {
    const rule = realComplexityRule();
    if (!rule) throw new Error('未在 eslint.config.js 找到 complexity 规则');
    expect(
      lintComplexity('function g(x){ return x + 1; }', rule.value)
    ).toEqual([]);
  });
});
