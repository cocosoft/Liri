/**
 * 请求侧工具配对完整性（R6，2026-09-21）
 *
 * 背景（真机实证，`~/.pyapp/data/logs/app.log`）：Tier3 折叠批按 token 预算切片，
 * 批尾极易停在 `assistant(tool_calls)` 与其工具结果之间 ⇒ 发给 provider 的
 * `[head, batch, 压缩指令]` 出现悬空 `tool_calls` ⇒ 上游 400
 * （`An assistant message with 'tool_calls' must be followed by tool messages…`）
 * ⇒ 连续 13 次 `tier3_fold_batch_error`、`applied:false`、上下文只增不减。
 *
 * 本文件锁定三层防护：
 *  ① `extractEarliestBatch` 切批**不落在配对中间**（`completeTrailingToolPairs`）；
 *  ② `sanitizeToolCallPairs` 发请求前**兜底收敛**（任何切片都满足上游协议）；
 *  ③ 孤立 tool 结果同样被清理（上游对"无调用的结果"同样 400）。
 */
import { describe, test, expect } from 'bun:test';
import type { ChatMessage } from '@modules/ai';
import {
  completeTrailingToolPairs,
  sanitizeToolCallPairs,
  unpairedToolCallIds,
} from '../../../src/context/compaction/toolPairIntegrity';
import { extractEarliestBatch } from '../../../src/context/compaction/CompactionOrchestrator';

/** assistant 带 tool_calls（可选带正文） */
function assistantWithCalls(ids: string[], content = ''): ChatMessage {
  return {
    role: 'assistant',
    content,
    tool_calls: ids.map((id) => ({
      id,
      type: 'function',
      function: { name: 'grep', arguments: '{}' },
    })),
  } as unknown as ChatMessage;
}

/** tool 结果（响应某个 tool_call_id） */
function toolResult(id: string): ChatMessage {
  return {
    role: 'tool',
    tool_call_id: id,
    content: `result-${id}`,
  } as unknown as ChatMessage;
}

function userMsg(content: string): ChatMessage {
  return { role: 'user', content } as ChatMessage;
}

describe('R6：unpairedToolCallIds', () => {
  test('批尾悬空 ⇒ 报出未配对 id', () => {
    const batch = [
      assistantWithCalls(['c1']),
      toolResult('c1'),
      assistantWithCalls(['c2']),
    ];
    expect([...unpairedToolCallIds(batch)]).toEqual(['c2']);
  });

  test('全部配对 ⇒ 空集', () => {
    const batch = [
      assistantWithCalls(['c1', 'c2']),
      toolResult('c1'),
      toolResult('c2'),
    ];
    expect(unpairedToolCallIds(batch).size).toBe(0);
  });

  test('部分配对（多调用只回了一个）⇒ 仍报出缺失项', () => {
    const batch = [assistantWithCalls(['c1', 'c2']), toolResult('c1')];
    expect([...unpairedToolCallIds(batch)]).toEqual(['c2']);
  });
});

describe('R6：completeTrailingToolPairs（切批不吃断配对）', () => {
  test('把紧随其后的工具结果并入批，rest 相应前移', () => {
    const assistant = assistantWithCalls(['c1']);
    const tool = toolResult('c1');
    const tail = userMsg('后续');
    const out = completeTrailingToolPairs([assistant], [tool, tail]);

    expect(out.batch).toEqual([assistant, tool]);
    expect(out.rest).toEqual([tail]);
    expect(unpairedToolCallIds(out.batch).size).toBe(0);
  });

  test('遇到非配对消息即停（不跨越后续轮次）', () => {
    const assistant = assistantWithCalls(['c1']);
    const out = completeTrailingToolPairs(
      [assistant],
      [userMsg('中间插了用户消息'), toolResult('c1')]
    );

    // 没吃进任何东西：宁可保留悬空（由 sanitize 兜底），也不吞无关消息
    expect(out.batch).toEqual([assistant]);
    expect(out.rest).toHaveLength(2);
  });

  test('已完全配对 ⇒ 原样返回', () => {
    const batch = [assistantWithCalls(['c1']), toolResult('c1')];
    const rest = [userMsg('x')];
    const out = completeTrailingToolPairs(batch, rest);
    expect(out.batch).toEqual(batch);
    expect(out.rest).toEqual(rest);
  });
});

describe('R6：sanitizeToolCallPairs（请求侧兜底）', () => {
  test('悬空 tool_calls 被摘掉，正文保留', () => {
    const messages = [
      assistantWithCalls(['c1'], '我要查代码'),
      toolResult('c1'),
      assistantWithCalls(['c2'], '接着查'),
      userMsg('压缩指令'),
    ];
    const out = sanitizeToolCallPairs(messages);

    // c1 配对完好 ⇒ 保留；c2 悬空 ⇒ 摘掉其 tool_calls，但 assistant 正文仍在
    const assistants = out.filter((m) => m.role === 'assistant');
    expect(assistants).toHaveLength(2);
    expect(
      (assistants[0] as unknown as Record<string, unknown>).tool_calls
    ).toBeDefined();
    expect(
      (assistants[1] as unknown as Record<string, unknown>).tool_calls
    ).toBeUndefined();
    expect(assistants[1].content).toBe('接着查');
    expect(out[out.length - 1].content).toBe('压缩指令');
  });

  test('部分配对：只保留有结果的那些 tool_calls', () => {
    const out = sanitizeToolCallPairs([
      assistantWithCalls(['c1', 'c2']),
      toolResult('c2'),
      userMsg('指令'),
    ]);
    const calls = (out[0] as unknown as Record<string, unknown>).tool_calls as
      | Array<{ id?: string }>
      | undefined;
    expect(calls?.map((c) => c.id)).toEqual(['c2']);
    expect(unpairedToolCallIds(out).size).toBe(0);
  });

  test('空壳（无正文 + 全悬空）整条丢弃', () => {
    const out = sanitizeToolCallPairs([
      assistantWithCalls(['c1']),
      userMsg('指令'),
    ]);
    expect(out).toEqual([userMsg('指令')]);
  });

  test('孤立 tool 结果（无调用声明）被丢弃', () => {
    const out = sanitizeToolCallPairs([
      userMsg('问'),
      toolResult('orphan'),
      userMsg('指令'),
    ]);
    expect(out.map((m) => m.role)).toEqual(['user', 'user']);
  });

  test('已配对的数组幂等（不产生任何改动）', () => {
    const messages = [
      userMsg('问'),
      assistantWithCalls(['c1']),
      toolResult('c1'),
      userMsg('指令'),
    ];
    const once = sanitizeToolCallPairs(messages);
    expect(once).toEqual(messages);
    expect(sanitizeToolCallPairs(once)).toEqual(once);
  });
});

describe('R6：extractEarliestBatch 切批不破配对', () => {
  test('预算切点落在 assistant 与结果之间 ⇒ 向前吃齐结果（修复前批尾悬空）', () => {
    const assistant = assistantWithCalls(['c1']);
    const tool = toolResult('c1');
    const tail = userMsg('x'.repeat(4000));

    // budget=1：任何"追加后超预算"都会在第一条消息之后立即切批 ⇒ 制造"切在配对中间"
    const { batch, rest } = extractEarliestBatch([assistant, tool, tail], 1);

    expect(batch.length).toBeGreaterThanOrEqual(2);
    expect(batch[0]).toBe(assistant);
    expect(batch[1]).toBe(tool);
    // 关键护栏：批内**不存在**悬空 tool_call（否则折叠请求必被上游 400）
    expect(unpairedToolCallIds(batch).size).toBe(0);
    expect(rest).toEqual([tail]);
  });
});

/**
 * 2026-11-28（真机 `session_mwykbdjuff65658510`）：后台压缩直传 `session.messages`，
 * 工具声明在 `metadata.tool_calls`、结果 id 在 `metadata.toolCallId`。原实现只读顶层字段
 * ⇒ 兜底收敛"看不见配对"⇒ 全量放行，由 transport 逐条剥离
 *（`stripped_orphan_tool_results count=30/47`），摘要模型看不到工具输出。
 */
describe('2026-11-28：内部消息形态（metadata 承载工具字段）同样收敛', () => {
  /** 内部形态的 assistant 声明 */
  function internalAssistant(ids: string[]): ChatMessage {
    return {
      role: 'assistant',
      content: '',
      metadata: {
        tool_calls: ids.map((id) => ({
          id,
          type: 'function',
          function: { name: 'grep', arguments: '{}' },
        })),
      },
    } as unknown as ChatMessage;
  }

  /** 内部形态的工具结果（`metadata.toolCallId`） */
  function internalToolResult(id: string): ChatMessage {
    return {
      role: 'tool',
      content: [{ type: 'tool_result', value: `r-${id}`, toolCallId: id }],
      metadata: { toolCallId: id },
    } as unknown as ChatMessage;
  }

  test('声明 + 结果（metadata 形态）⇒ 配对完整、一条不丢', () => {
    const messages = [
      userMsg('问'),
      internalAssistant(['c1', 'c2']),
      internalToolResult('c1'),
      internalToolResult('c2'),
      userMsg('压缩指令'),
    ];
    expect(unpairedToolCallIds(messages).size).toBe(0);

    const out = sanitizeToolCallPairs(messages);
    expect(out.filter((m) => m.role === 'tool')).toHaveLength(2);
    expect(out).toHaveLength(messages.length);
  });

  test('切批落在工具结果中间 ⇒ 前导孤立结果被丢弃（不再漏到 transport）', () => {
    const out = sanitizeToolCallPairs([
      internalToolResult('c9'),
      internalToolResult('c10'),
      userMsg('压缩指令'),
    ]);
    expect(out.map((m) => m.role)).toEqual(['user']);
  });

  test('切批只拿到部分结果 ⇒ 声明按已配对的子集收窄', () => {
    const out = sanitizeToolCallPairs([
      internalAssistant(['c1', 'c2']),
      internalToolResult('c2'),
      userMsg('压缩指令'),
    ]);
    const calls = (out[0] as unknown as Record<string, unknown>).tool_calls as
      | Array<{ id?: string }>
      | undefined;
    expect(calls?.map((c) => c.id)).toEqual(['c2']);
    expect(unpairedToolCallIds(out).size).toBe(0);
  });
});
