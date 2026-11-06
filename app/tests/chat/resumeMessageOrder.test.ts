// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P0-2（2026-11-06）：审批恢复后的消息顺序修复用例。
 *
 * 真机 400：`Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`
 * —— 序列为 `assistant(tool_calls) → assistant(⏸ 等待审批) → tool(result)`。
 */
import { describe, expect, it } from 'bun:test';
import {
  dedupeToolResults,
  isReplayedToolResult,
  orderToolResultsAfterOwners,
  toolResultCallIdOf,
} from '../../src/chat/manager/resumeMessageOrder';

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

/**
 * N-15（2026-11-06 真机）：同一 `tool_call_id` 被应答两次 ⇒ provider 400。
 * 续跑入口须剔除"待审批占位"结果，只保留重放产出的真实结果。
 * 占位结果的 id 在三种形态下都要能识别（顶层 / `metadata.toolCallId` / 内容块或 JSON 字符串）。
 */
describe('isReplayedToolResult（N-15）', () => {
  const replay = new Set(['call_A']);

  it('顶层 toolCallId 命中', () => {
    expect(
      isReplayedToolResult({ role: 'tool', toolCallId: 'call_A' }, replay)
    ).toBe(true);
  });

  it('id 只在 metadata.toolCallId（持久化读回形状）也命中', () => {
    expect(
      isReplayedToolResult(
        { role: 'tool', metadata: { toolCallId: 'call_A' }, content: '{}' },
        replay
      )
    ).toBe(true);
  });

  it('content 为 JSON 字符串且块内带 toolCallId（续跑内 ReAct 循环形状）也命中', () => {
    const content = JSON.stringify([
      {
        type: 'tool_result',
        value: '{"status":"awaiting_approval"}',
        toolCallId: 'call_A',
      },
    ]);
    expect(isReplayedToolResult({ role: 'tool', content }, replay)).toBe(true);
  });

  it('content 为数组块也命中', () => {
    expect(
      isReplayedToolResult(
        {
          role: 'tool',
          content: [{ type: 'tool_result', toolCallId: 'call_A' }],
        },
        replay
      )
    ).toBe(true);
  });

  it('非重放调用 / 非 tool 角色 / 纯文本结果 ⇒ 不命中', () => {
    expect(
      isReplayedToolResult({ role: 'tool', toolCallId: 'call_B' }, replay)
    ).toBe(false);
    expect(
      isReplayedToolResult({ role: 'assistant', toolCallId: 'call_A' }, replay)
    ).toBe(false);
    expect(
      isReplayedToolResult({ role: 'tool', content: '普通工具输出' }, replay)
    ).toBe(false);
  });

  it('toolResultCallIdOf 的取值优先级：顶层 → metadata → 内容块', () => {
    expect(
      toolResultCallIdOf({
        toolCallId: 'top',
        metadata: { toolCallId: 'meta' },
      })
    ).toBe('top');
    expect(toolResultCallIdOf({ metadata: { toolCallId: 'meta' } })).toBe(
      'meta'
    );
    expect(
      toolResultCallIdOf({
        content: '[{"type":"tool_result","toolCallId":"blk"}]',
      })
    ).toBe('blk');
    expect(toolResultCallIdOf({ content: '[not json' })).toBeUndefined();
  });
});

/**
 * N-15：往次审批留下的「占位 + 真实结果」会累积成"同一 call 两条应答" ⇒ provider 400。
 * 发送前按 tool_call_id 去重，保留**最后一条**（真实结果总在占位之后）。
 */
describe('dedupeToolResults（N-15）', () => {
  const placeholder = (id: string) => ({
    role: 'tool',
    content: JSON.stringify([
      {
        type: 'tool_result',
        value: '{"status":"awaiting_approval"}',
        toolCallId: id,
      },
    ]),
  });
  const realResult = (id: string) => ({
    role: 'tool',
    metadata: { toolCallId: id },
    content: '真实输出',
  });

  it('同一 call 两条 ⇒ 保留最后一条（真实结果）', () => {
    const msgs = [
      { role: 'assistant', tool_calls: [{ id: 'c1' }], content: '' },
      placeholder('c1'),
      realResult('c1'),
    ];
    const out = dedupeToolResults(msgs);
    expect(out).toHaveLength(2);
    expect(out[1].content).toBe('真实输出');
  });

  it('不同 call 各一条 ⇒ 原样返回同一引用（零开销）', () => {
    const msgs = [
      { role: 'assistant', tool_calls: [{ id: 'c1' }, { id: 'c2' }] },
      realResult('c1'),
      realResult('c2'),
    ];
    expect(dedupeToolResults(msgs)).toBe(msgs);
  });

  it('多条历史重复（两次审批各留一份）⇒ 每个 call 只留最后一条', () => {
    const msgs = [
      placeholder('c1'),
      realResult('c1'),
      placeholder('c2'),
      realResult('c2'),
      placeholder('c3'),
      realResult('c3'),
    ];
    const out = dedupeToolResults(msgs);
    expect(out).toHaveLength(3);
    expect(out.map((m) => m.content)).toEqual([
      '真实输出',
      '真实输出',
      '真实输出',
    ]);
  });

  it('无 tool_call_id 的消息不参与去重（无法配对 ⇒ 保持原样）', () => {
    const msgs = [
      { role: 'tool', content: '普通输出A' },
      { role: 'tool', content: '普通输出B' },
    ];
    expect(dedupeToolResults(msgs)).toBe(msgs);
  });
});
