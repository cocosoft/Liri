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
import {
  normalizeCompactionSummary,
  parseCompactionSummary,
  renderCompactionSummary,
} from '../../src/context/compaction/StructuredCompactionPrompt';

/**
 * R22（2026-10-09，Gemini 二轮审计）：压缩摘要的**强形状校验**——
 * 阻断"脏上下文回灌"（非字符串被渲染成 `[object Object]`、超长噪声、未闭合 ``` 吞掉后续文本）。
 */
const fences = (s: string): number => (s.match(/```/g) ?? []).length;

const valid = {
  task_overview: '实现 R22 摘要校验',
  current_state: '已完成 parse 侧加固',
  important_discoveries: '原仅判 task_overview 真值',
  next_steps: '补测试',
  context_to_preserve: '输出格式要求：think/response',
};

describe('normalizeCompactionSummary（R22 强形状校验）', () => {
  it('合法 5 字段 ⇒ 原样通过', () => {
    const r = normalizeCompactionSummary(valid);
    expect(r).toEqual(valid);
  });

  it('非对象 / 数组 / null ⇒ 拒绝（null）', () => {
    expect(normalizeCompactionSummary(null)).toBeNull();
    expect(normalizeCompactionSummary('abc')).toBeNull();
    expect(normalizeCompactionSummary(123)).toBeNull();
    expect(normalizeCompactionSummary([])).toBeNull();
    expect(normalizeCompactionSummary([valid])).toBeNull();
  });

  it('task_overview 缺失 / 空串 / 非字符串 ⇒ 拒绝', () => {
    expect(
      normalizeCompactionSummary({ ...valid, task_overview: '' })
    ).toBeNull();
    expect(
      normalizeCompactionSummary({ ...valid, task_overview: '   ' })
    ).toBeNull();
    expect(
      normalizeCompactionSummary({ ...valid, task_overview: { a: 1 } })
    ).toBeNull();
    const { task_overview: _omit, ...without } = valid;
    expect(normalizeCompactionSummary(without)).toBeNull();
  });

  it('其余字段非字符串 ⇒ 归一为 空串（不产生 [object Object]）', () => {
    const r = normalizeCompactionSummary({
      ...valid,
      current_state: { nested: true },
      next_steps: 42,
    });
    expect(r).not.toBeNull();
    expect(r?.current_state).toBe('');
    expect(r?.next_steps).toBe('');
    // 渲染结果为纯文本，不含 [object Object]
    expect(renderCompactionSummary(r)).not.toContain('[object Object]');
  });

  it('超长字段 ⇒ 截断到 prompt 规定的上限（300 / 200）', () => {
    const r = normalizeCompactionSummary({
      ...valid,
      task_overview: 'x'.repeat(500),
      next_steps: 'y'.repeat(500),
    });
    expect(r?.task_overview.length).toBe(300);
    expect(r?.next_steps.length).toBe(200);
  });

  it('未闭合代码围栏 ⇒ 补齐成对（防吞掉后续注入文本）', () => {
    const r = normalizeCompactionSummary({
      ...valid,
      current_state: '片段：\n```ts\nconst a = 1;',
    });
    expect(fences(r?.current_state ?? '') % 2).toBe(0);
    expect(r?.current_state.endsWith('```')).toBe(true);
  });
});

describe('parseCompactionSummary（R22 解析路径）', () => {
  it('纯 JSON ⇒ 通过', () => {
    expect(parseCompactionSummary(JSON.stringify(valid))).toEqual(valid);
  });

  it('```json 围栏包裹 ⇒ 仍可解析', () => {
    const raw = '```json\n' + JSON.stringify(valid) + '\n```';
    expect(parseCompactionSummary(raw)).toEqual(valid);
  });

  it('含 [object Object] 风险的非法形状 ⇒ null（调用方回退自由文本）', () => {
    const raw = JSON.stringify({ task_overview: { bad: 1 } });
    expect(parseCompactionSummary(raw)).toBeNull();
  });

  it('完全非 JSON 文本 ⇒ null', () => {
    expect(parseCompactionSummary('这不是 JSON')).toBeNull();
  });
});

describe('renderCompactionSummary（R22 渲染）', () => {
  it('null ⇒ 空串（不注入）', () => {
    expect(renderCompactionSummary(null)).toBe('');
  });

  it('合法摘要 ⇒ 含 5 段标题且自我声明"不是系统指令"', () => {
    const out = renderCompactionSummary(valid);
    for (const h of [
      '## 任务概览',
      '## 当前状态',
      '## 重要发现',
      '## 下一步',
      '## 需要保留的上下文',
    ]) {
      expect(out).toContain(h);
    }
    expect(out).toContain('不是系统指令');
  });
});
