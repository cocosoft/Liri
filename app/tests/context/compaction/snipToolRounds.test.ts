/**
 * D1（2026-09-21）：Tier2 按**工具轮**裁剪（agentic 会话兜底）
 *
 * 问题（真机实证，`~/.pyapp/data/logs/app.log`）：`groupByTurns` 以 **user 消息**切轮，
 * 默认 `keepHeadTurns(2) + keepTailTurns(4) = 6` 才开始动刀；而 agentic 会话的体量由
 * **工具轮**贡献（真机：226 消息 / 75 工具轮 / user 轮次极少）⇒ 门禁恒成立 ⇒
 * `applied:false` ⇒ 每次压缩都升级 Tier3（一次 LLM 调用），连"超长消息截断"也被
 * 同一道门禁挡在外面。
 *
 * 本文件锁定修复后的契约：
 *  ① 工具轮足够多 ⇒ 按工具轮裁中间、保首尾，**零 LLM** 降 token；
 *  ② 工具轮不足 ⇒ 如实 `applied:false`（不臆造、不制造"裁了但没省"）；
 *  ③ 裁剪结果**配对完整**（悬空 tool_calls / 孤立 tool 结果都会被上游 400）；
 *  ④ 当前提问与 system 头不丢；
 *  ⑤ 既有 user 轮裁剪路径**行为不变**（回归）；
 *  ⑥ 超长截断已提到门禁之前 ⇒ 单条巨大 tool_result 场景也能生效。
 */
import { describe, test, expect } from 'bun:test';
import type { ChatMessage } from '../../../src/ai/models/types';
import { estimateMessagesTokens } from '../../../src/ai/tokenizer/TokenEstimator.js';
import {
  snipMessages,
  isSnipBoundaryMessage,
} from '../../../src/context/compaction/SnipEngine';
import { unpairedToolCallIds } from '../../../src/context/compaction/toolPairIntegrity';

function user(content: string): ChatMessage {
  return { role: 'user', content };
}

function assistantText(content: string): ChatMessage {
  return { role: 'assistant', content };
}

function assistantCalls(ids: string[]): ChatMessage {
  return {
    role: 'assistant',
    content: '',
    tool_calls: ids.map((id) => ({
      id,
      type: 'function',
      function: { name: 'file_read', arguments: '{}' },
    })),
  } as unknown as ChatMessage;
}

function toolResult(id: string, content: string): ChatMessage {
  return { role: 'tool', tool_call_id: id, content } as unknown as ChatMessage;
}

/**
 * 造一个 agentic 会话：1 条 user 指令 + N 个工具轮（assistant(tool_calls) + tool 结果）。
 * 这正是真机形态：user 轮次极少、工具轮很多。
 *
 * 载荷刻意取小（400 字符/轮）：`estimateMessagesTokens` 是 O(字符数) 的真实分词估算，
 * 全量套件（286 文件并发）下大载荷会把用例推到 bun 默认 5s 超时之外 —— 断言只关心
 * "裁剪后是否真降 token / 轮数是否对"，载荷大小不影响结论。
 */
function agenticSession(rounds: number, payloadChars = 400): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: '你是助手。' } as ChatMessage,
    user('请完成这个大任务'),
  ];
  for (let i = 0; i < rounds; i++) {
    messages.push(assistantCalls([`c${i}`]));
    messages.push(
      toolResult(`c${i}`, `第${i}轮工具结果 ${'x'.repeat(payloadChars)}`)
    );
  }
  return messages;
}

/** 造 N 条 user 轮（每轮一条 user + 一条 assistant 文本），用于回归既有路径 */
function multiUserTurns(turns: number): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < turns; i++) {
    messages.push(user(`第 ${i + 1} 问`));
    messages.push(assistantText(`第 ${i + 1} 答`));
  }
  return messages;
}

describe('D1：按工具轮裁剪（agentic 兜底）', () => {
  test('30 个工具轮 ⇒ 裁中间 20 轮、保首 2 + 尾 8，且零悬空配对', () => {
    const messages = agenticSession(30);
    const before = estimateMessagesTokens(messages);

    const result = snipMessages(messages);

    expect(result.applied).toBe(true);
    expect(result.toolRoundsSnipped).toBe(30 - 2 - 8);
    // 真降 token（修复前 applied:false ⇒ 调用方只能升级 Tier3）
    const after = estimateMessagesTokens(result.messages);
    expect(after).toBeLessThan(before);
    // 配对完整（悬空 tool_calls 会被上游 400）
    expect(unpairedToolCallIds(result.messages).size).toBe(0);
    // 无孤立 tool 结果（其 tool_call_id 必须有对应调用声明）
    const declared = new Set(
      result.messages.flatMap((m) => {
        const tcs = (m as unknown as Record<string, unknown>).tool_calls as
          | Array<{ id?: string }>
          | undefined;
        return (tcs ?? []).map((tc) => tc.id ?? '');
      })
    );
    const orphans = result.messages.filter((m) => {
      const rid = (m as unknown as Record<string, unknown>).tool_call_id as
        | string
        | undefined;
      return !!rid && !declared.has(rid);
    });
    expect(orphans).toEqual([]);
  }, 20000); // 显式超时：全量套件并发运行时本用例需做两次真实分词估算（默认 5s 过紧）

  test('system 头与当前 user 指令保留，中段以边界占位声明', () => {
    const messages = agenticSession(30);
    const result = snipMessages(messages);

    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toBe('你是助手。');
    expect(
      result.messages.some(
        (m) => m.role === 'user' && m.content === '请完成这个大任务'
      )
    ).toBe(true);
    const boundary = result.messages.find(
      (m) => typeof m.content === 'string' && isSnipBoundaryMessage(m.content)
    );
    expect(boundary).toBeDefined();
    expect(String(boundary?.content)).toContain('已裁剪中间的 20 个工具调用轮次');
  });

  test('工具轮不足（3 ≤ 2+8）⇒ 不臆造，如实 applied:false', () => {
    const messages = agenticSession(3);
    const result = snipMessages(messages);

    expect(result.applied).toBe(false);
    expect(result.toolRoundsSnipped).toBe(0);
    expect(result.messages).toEqual(messages);
  });

  test('尾部在飞轮（assistant 有 tool_calls 但结果未回）⇒ 输出仍配对完整', () => {
    const messages = agenticSession(12);
    // 模拟压缩发生在流式中间：最后一个 assistant 已声明调用、tool 结果尚未入列
    messages.push(assistantCalls(['inflight']));

    const result = snipMessages(messages);

    expect(result.applied).toBe(true);
    expect(unpairedToolCallIds(result.messages).size).toBe(0);
  });

  test('自定义 keepHeadToolRounds / keepTailToolRounds 生效', () => {
    const result = snipMessages(agenticSession(20), {
      keepHeadToolRounds: 1,
      keepTailToolRounds: 3,
    });
    expect(result.applied).toBe(true);
    expect(result.toolRoundsSnipped).toBe(20 - 1 - 3);
  });
});

describe('D1：既有 user 轮裁剪路径回归', () => {
  test('8 个 user 轮 ⇒ 仍走原路径（turnsSnipped>0，未走工具轮）', () => {
    const messages = multiUserTurns(8);
    const result = snipMessages(messages);

    expect(result.applied).toBe(true);
    expect(result.turnsSnipped).toBe(8 - 2 - 4);
    expect(result.toolRoundsSnipped).toBeUndefined();
  });

  test('≤6 个 user 轮且无工具轮 ⇒ applied:false（与修复前一致）', () => {
    const messages = multiUserTurns(5);
    const result = snipMessages(messages);
    expect(result.applied).toBe(false);
    expect(result.turnsSnipped).toBe(0);
  });
});

describe('D1：超长截断提前到门禁之前（附带修 B）', () => {
  test('单条 20000 字符 tool 结果 + 工具轮不足 ⇒ 截断生效（修复前完全不动）', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: '你是助手。' } as ChatMessage,
      user('问一句'),
      assistantCalls(['c0']),
      toolResult('c0', 'y'.repeat(20_000)),
      assistantText('结论'),
    ];

    const result = snipMessages(messages);

    expect(result.applied).toBe(true); // 修复前：门禁早退 ⇒ 恒 false
    const tool = result.messages.find((m) => m.role === 'tool');
    expect(String(tool?.content)).toContain('内容过长已截断');
    expect(String(tool?.content).length).toBeLessThan(20_000);
  });

  test('最后一条 user 提问**永不截断**（BUG-FIX 语义保持）', () => {
    const longQuestion = `提问 ${'q'.repeat(20_000)}`;
    const messages: ChatMessage[] = [
      { role: 'system', content: '你是助手。' } as ChatMessage,
      user(longQuestion),
    ];

    const result = snipMessages(messages);

    const last = result.messages[result.messages.length - 1];
    expect(last.content).toBe(longQuestion);
  });
});
