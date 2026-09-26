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
 * A1（2026-09-26，《Liri 优化方案》）：报告落盘保留工具调用参数。
 *
 * 锁两件事：
 *  ① **`toolCallNames()` 行为不变**（既有报告格式与断言依赖它）；
 *  ② `buildToolCallsDetail()` 的**结构稳定** + 逐值截断规则（原语原样 / 字符串裁剪 /
 *     对象超长降级为字符串 / 不可序列化不抛错）。
 *
 * 纯函数、无沙箱与网络依赖。
 */
import { describe, expect, it } from 'bun:test';
import {
  buildToolCallsDetail,
  toolCallNames,
  TOOL_CALL_ARG_MAX_CHARS,
} from '../../src/evals/trace';
import type { ToolCallRecord } from '../../src/evals/types';

function call(
  name: string,
  args?: Record<string, unknown>
): ToolCallRecord {
  return { name, args };
}

describe('A1: toolCallNames() 行为不变（既有契约）', () => {
  it('按发生顺序返回工具名；args 不影响结果', () => {
    const calls = [
      call('file_read', { file_path: '/w/a.txt' }),
      call('grep', { pattern: 'foo' }),
      call('file_write', { file_path: '/w/b.txt', content: 'x' }),
    ];
    expect(toolCallNames(calls)).toEqual(['file_read', 'grep', 'file_write']);
  });

  it('空序列 ⇒ 空数组（不抛错）', () => {
    expect(toolCallNames([])).toEqual([]);
    expect(buildToolCallsDetail([])).toEqual([]);
  });
});

describe('A1: buildToolCallsDetail() 结构稳定 + 逐值截断', () => {
  it('短参数原样保留（字符串/数字/布尔/短对象）', () => {
    const detail = buildToolCallsDetail([
      call('file_read', {
        file_path: '/w/a.txt',
        offset: 10,
        limit: 50,
        follow: true,
      }),
      call('file_edit', { file_path: '/w/a.txt', old: { a: 1 }, new: { b: 2 } }),
    ]);

    expect(detail[0].name).toBe('file_read');
    expect(detail[0].args).toEqual({
      file_path: '/w/a.txt',
      offset: 10,
      limit: 50,
      follow: true,
    });
    // 短对象**保留原结构**（不降级为字符串）
    expect(detail[1].args).toEqual({
      file_path: '/w/a.txt',
      old: { a: 1 },
      new: { b: 2 },
    });
  });

  it('无 args 的调用 ⇒ 条目**不含 args 键**（不写显式 undefined）', () => {
    const detail = buildToolCallsDetail([call('todo_write')]);
    expect(detail[0].name).toBe('todo_write');
    expect(Object.prototype.hasOwnProperty.call(detail[0], 'args')).toBe(false);
  });

  it('超长字符串 ⇒ 裁剪并附 …[+N]（保留可读后缀）', () => {
    const long = 'x'.repeat(TOOL_CALL_ARG_MAX_CHARS + 12);
    const detail = buildToolCallsDetail([
      call('file_write', { content: long }),
    ]);
    const args = detail[0].args as Record<string, unknown>;
    const content = args.content as string;
    expect(typeof content).toBe('string');
    expect(content.startsWith('x'.repeat(TOOL_CALL_ARG_MAX_CHARS))).toBe(true);
    expect(content.endsWith('…[+12]')).toBe(true);
  });

  it('边界：长度恰等于上限 ⇒ **不裁剪**（无省略标记）', () => {
    const exact = 'y'.repeat(TOOL_CALL_ARG_MAX_CHARS);
    const detail = buildToolCallsDetail([call('file_write', { content: exact })]);
    const args = detail[0].args as Record<string, unknown>;
    expect(args.content).toBe(exact);
  });

  it('超长对象/数组 ⇒ 降级为带省略标记的字符串（防报告体积失控）', () => {
    const detail = buildToolCallsDetail([
      call('doc_generate', { nodes: Array.from({ length: 80 }, (_, i) => ({
        title: `节 ${i}`,
      })) }),
    ]);
    const args = detail[0].args as Record<string, unknown>;
    expect(typeof args.nodes).toBe('string');
    expect((args.nodes as string).includes('…[+')).toBe(true);
  });

  it('不可序列化（循环引用）⇒ 标记而非抛错（报告不因参数形状失败）', () => {
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;
    const detail = buildToolCallsDetail([call('file_write', { content: circular })]);
    const args = detail[0].args as Record<string, unknown>;
    expect(args.content).toBe('[unserializable]');
  });
});
