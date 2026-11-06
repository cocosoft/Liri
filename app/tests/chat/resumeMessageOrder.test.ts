// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P0-2（2026-11-06）：审批恢复后的消息顺序修复用例。
 *
 * 真机 400：`Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`
 * —— 序列为 `assistant(tool_calls) → assistant(⏸ 等待审批) → tool(result)`。
 */
import { describe, expect, it } from 'bun:test';
import { orderToolResultsAfterOwners } from '../../src/chat/manager/resumeMessageOrder';

type M = {
  role?: string;
  tool_calls?: Array<{ id?: unknown }>;
  tool_call_id?: string;
  content?: string;
};

const assistantWithCalls = (...ids: string[]): M => ({
  role: 'assistant',
  tool_calls: ids.map((id) => ({ id })),
  content: '',
});
const toolMsg = (id: string): M => ({
  role: 'tool',
  tool_call_id: id,
  content: id,
});
const text = (content: string): M => ({ role: 'assistant', content });

describe('orderToolResultsAfterOwners（P0-2）', () => {
  it('已合法（tool 紧跟 owner）⇒ 返回同一引用（零开销）', () => {
    const msgs = [
      { role: 'user', content: 'hi' },
      assistantWithCalls('c1'),
      toolMsg('c1'),
      text('done'),
    ];
    expect(orderToolResultsAfterOwners(msgs)).toBe(msgs);
  });

  it('等待审批提示夹在中间 ⇒ tool 上移到 owner 之后（提示保留）', () => {
    const msgs = [
      { role: 'user', content: 'hi' },
      assistantWithCalls('c1'),
      text('⏸ 有工具调用正在等待你的审批'),
      toolMsg('c1'),
    ];
    const out = orderToolResultsAfterOwners(msgs) as M[];
    expect(out.map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(out[2].tool_call_id).toBe('c1');
    // 提示消息不丢
    expect(out[3].content).toContain('等待你的审批');
  });

  it('同 owner 的批量 tool 保持相对顺序', () => {
    const msgs = [
      assistantWithCalls('c1', 'c2'),
      text('⏸ 等待审批'),
      toolMsg('c1'),
      toolMsg('c2'),
    ];
    const out = orderToolResultsAfterOwners(msgs) as M[];
    expect(
      out.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)
    ).toEqual(['c1', 'c2']);
    expect(out[1].role).toBe('tool');
  });

  it('无 owner 的 tool 消息被剔除（对模型无意义且必然 400）', () => {
    const msgs = [assistantWithCalls('c1'), toolMsg('c1'), toolMsg('ghost')];
    const out = orderToolResultsAfterOwners(msgs) as M[];
    expect(out.map((m) => m.tool_call_id ?? m.role)).toEqual([
      'assistant',
      'c1',
    ]);
  });

  it('无 tool 消息 ⇒ 原样返回同一引用', () => {
    const msgs = [{ role: 'user', content: 'hi' }, text('ok')];
    expect(orderToolResultsAfterOwners(msgs)).toBe(msgs);
  });
});
