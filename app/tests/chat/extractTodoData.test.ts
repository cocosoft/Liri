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
 * P2-1（2026-09-26）：`extractTodoData` 必须**透传 `planId`**。
 *
 * 病灶：生产方 `TodoWriteTool._buildTodoData()` 一直带 `planId`，下游也一直**条件**消费它
 * （扩容键 `planId ?? title`、`taskCard.planId`），唯独本函数把它丢了 ⇒ 下游三处的
 * planId 分支**恒不可达**（键实际恒为 title、`taskCard.planId` 永不出现）。
 *
 * 第 2 例是本修复的**反向防线**：`planId` 缺失时**不得**产生显式 `undefined` 键 ——
 * 计划事件的载荷校验会据此判 `invalid-event`（见 streamMessageFlow.ts:2331 注释）。
 */
import { describe, it, expect } from 'bun:test';
import { extractTodoData } from '../../src/chat/services/ChatHelper';

/**
 * 用**参数类型推导**而非按名导入某个 `ToolResult`：全仓存在 ≥4 处同名 `ToolResult`
 * （见台账「全仓 ≥4 处同名 ToolResult」条），按名导入极易拿到"另一个"——本文件首版
 * 即因此 typecheck 报 4 处 TS2345（`ToolResult<unknown>` ≠ `ToolResult`）。
 */
type ExtractInput = Parameters<typeof extractTodoData>[0];

function withTodoData(todoData: Record<string, unknown>): ExtractInput {
  return { metadata: { _todoData: todoData } } as unknown as ExtractInput;
}

const tasks = [{ id: 't1', name: '任务一', status: 'pending', dependsOn: [] }];

describe('extractTodoData · planId 透传（P2-1）', () => {
  it('生产方带 planId ⇒ 原样透传', () => {
    const data = extractTodoData(withTodoData({ title: '计划A', phase: 'planning', planId: 'plan-1', tasks }));
    expect(data?.planId).toBe('plan-1');
    expect(data?.title).toBe('计划A');
  });

  it('planId 缺失或空 ⇒ **键不存在**（不得留 undefined 显式键，否则事件校验判 invalid-event）', () => {
    for (const raw of [
      { title: '计划A', phase: 'planning', tasks },
      { title: '计划A', phase: 'planning', planId: '', tasks },
      { title: '计划A', phase: 'planning', planId: 123, tasks },
    ]) {
      const data = extractTodoData(withTodoData(raw));
      expect(data).not.toBeNull();
      expect(Object.prototype.hasOwnProperty.call(data, 'planId')).toBe(false);
    }
  });

  it('既有行为不回归：无 _todoData 或 tasks 非数组 ⇒ null', () => {
    expect(extractTodoData({} as unknown as ExtractInput)).toBeNull();
    expect(
      extractTodoData({ metadata: { _todoData: { title: 'x', tasks: 'not-an-array' } } } as unknown as ExtractInput)
    ).toBeNull();
  });
});
