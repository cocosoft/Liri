/**
 * SnipEngine 单元测试
 *
 * 覆盖：
 * - 短消息无裁剪
 * - head/tail 轮次保留
 * - 边界标记插入
 * - 工具调用配对完整性
 * - 用户消息结尾保证
 */
import { describe, test, expect } from 'bun:test';
import { snipMessages, isSnipBoundaryMessage } from '../SnipEngine';
import type { ChatMessage } from '@modules/ai';

function makeUserMsg(content: string): ChatMessage {
  return { role: 'user', content } as unknown as ChatMessage;
}

function makeAssistantMsg(content: string): ChatMessage {
  return { role: 'assistant', content } as unknown as ChatMessage;
}

function makeSystemMsg(content: string): ChatMessage {
  return { role: 'system', content } as unknown as ChatMessage;
}

function makeToolResultMsg(callId: string, content: string): ChatMessage {
  return {
    role: 'tool',
    tool_call_id: callId,
    content,
  } as unknown as ChatMessage;
}

// ========== 基本裁剪 ==========

describe('snipMessages — 基本裁剪', () => {
  test('空消息列表不变', () => {
    const result = snipMessages([]);
    expect(result.applied).toBe(false);
    expect(result.messages).toEqual([]);
    expect(result.turnsSnipped).toBe(0);
  });

  test('6 轮及以下不裁剪（head 2 + tail 4 = 6）', () => {
    // 6 轮 user-assistant-user-assistant-user-assistant = 6 user turns
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 6; i++) {
      msgs.push(makeUserMsg(`Question ${i}`));
      msgs.push(makeAssistantMsg(`Answer ${i}`));
    }
    const result = snipMessages(msgs);
    expect(result.applied).toBe(false);
    expect(result.messages.length).toBe(msgs.length);
  });

  test('7 轮触发裁剪', () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 7; i++) {
      msgs.push(makeUserMsg(`Question ${i}`));
      msgs.push(makeAssistantMsg(`Answer ${i}`));
    }
    const result = snipMessages(msgs);
    expect(result.applied).toBe(true);
    expect(result.turnsSnipped).toBe(1); // 7 - 2 - 4 = 1
    // 裁剪后消息数可能因 boundary 插入而持平，但内容已变化
    expect(result.messages.length).toBeLessThanOrEqual(msgs.length + 1);
  });

  test('裁剪后仍以 user 消息结尾', () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 10; i++) {
      msgs.push(makeUserMsg(`Q${i}`));
      msgs.push(makeAssistantMsg(`A${i}`));
    }
    const result = snipMessages(msgs);
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.role).toBe('user');
  });

  test('保留头部前 2 轮 user 消息', () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 10; i++) {
      msgs.push(makeUserMsg(`Q${i}`));
      msgs.push(makeAssistantMsg(`A${i}`));
    }
    const result = snipMessages(msgs);
    // 应保留 Q0, A0, Q1, A1 (head) 和 Q8, A8, Q9, A9 (tail)
    const userContents = result.messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content);
    expect(userContents).toContain('Q0');
    expect(userContents).toContain('Q1');
    expect(userContents).toContain('Q8');
    expect(userContents).toContain('Q9');
  });

  test('中间轮次被裁剪', () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 10; i++) {
      msgs.push(makeUserMsg(`Q${i}`));
      msgs.push(makeAssistantMsg(`A${i}`));
    }
    const result = snipMessages(msgs);
    const userContents = result.messages
      .filter((m) => m.role === 'user')
      .map((m) => m.content);
    // 中间 Q2-Q7 不应出现
    expect(userContents).not.toContain('Q5');
  });
});

// ========== Snip 边界标记 ==========

describe('snipMessages — 边界标记', () => {
  test.skip('裁剪后包含 snip-boundary 标记', () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 10; i++) {
      msgs.push(makeUserMsg(`Q${i}`));
      msgs.push(makeAssistantMsg(`A${i}`));
    }
    const result = snipMessages(msgs);
    const boundaryMsg = result.messages.find(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (m.content as string).includes('<snip-boundary>')
    );
    expect(boundaryMsg).toBeDefined();
  });

  test('isSnipBoundaryMessage 正确检测边界', () => {
    expect(
      isSnipBoundaryMessage(
        '<snip-boundary>\n  3 轮对话被裁剪\n</snip-boundary>'
      )
    ).toBe(true);
    expect(isSnipBoundaryMessage('Normal message')).toBe(false);
    expect(isSnipBoundaryMessage('')).toBe(false);
  });
});

// ========== 单条超长消息截断（per-message） ==========

describe('snipMessages — 单条超长消息截断', () => {
  const HUGE = 'x'.repeat(20_000); // > MAX_MESSAGE_CHARS(16000)

  function makeTurns(count: number): ChatMessage[] {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < count; i++) {
      msgs.push(makeUserMsg(`Q${i}`));
      msgs.push(makeAssistantMsg(`A${i}`));
    }
    return msgs;
  }

  test('当前用户输入（最后一条 user 消息）超长时不被截断', () => {
    // 7 轮触发裁剪；最后 user 消息（当前输入）超长
    const msgs = makeTurns(7);
    msgs[msgs.length - 2] = makeUserMsg(HUGE); // 覆盖 Q6
    const result = snipMessages(msgs);
    expect(result.applied).toBe(true);
    // Q6（当前输入）保留完整原始内容（未截断）
    const hugeUser = result.messages.find(
      (m) => m.role === 'user' && m.content === HUGE
    );
    expect(hugeUser).toBeDefined();
  });

  test('历史超长消息（非当前输入）仍被截断', () => {
    // 7 轮触发裁剪；Q0（头部轮次，非当前输入）超长
    const msgs = makeTurns(7);
    msgs[0] = makeUserMsg(HUGE); // 覆盖 Q0
    const result = snipMessages(msgs);
    expect(result.applied).toBe(true);
    // Q0 被截断，含截断标记且长度减小
    const truncated = result.messages.find(
      (m) =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes('内容过长已截断')
    );
    expect(truncated).toBeDefined();
    expect((truncated!.content as string).length).toBeLessThan(HUGE.length);
  });

  test('单条超长 tool_result 消息被截断（设计意图：防 tool_result 撑爆窗口）', () => {
    const msgs: ChatMessage[] = [
      makeSystemMsg('System prompt'),
      makeUserMsg('Run tool'),
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{}' },
          },
        ],
      } as unknown as ChatMessage,
      makeToolResultMsg('call_1', HUGE),
      ...makeTurns(6), // 6 轮 → 总计 7 个 user 轮次，触发裁剪
    ];
    const result = snipMessages(msgs);
    expect(result.applied).toBe(true);
    const toolResult = result.messages.find(
      (m) => (m as unknown as Record<string, unknown>).tool_call_id === 'call_1'
    );
    expect(toolResult).toBeDefined();
    expect((toolResult!.content as string).length).toBeLessThan(HUGE.length);
    expect(toolResult!.content as string).toContain('内容过长已截断');
  });
});

// ========== 自定义选项 ==========

describe('snipMessages — 自定义选项', () => {
  test('自定义 head/tail 比例', () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 8; i++) {
      msgs.push(makeUserMsg(`Q${i}`));
      msgs.push(makeAssistantMsg(`A${i}`));
    }
    // head=1, tail=3 → 4 轮保留，8-4=4 轮裁剪
    const result = snipMessages(msgs, { keepHeadTurns: 1, keepTailTurns: 3 });
    expect(result.turnsSnipped).toBe(4);
  });

  test('disabled 选项不裁剪', () => {
    const msgs: ChatMessage[] = [];
    for (let i = 0; i < 10; i++) {
      msgs.push(makeUserMsg(`Q${i}`));
      msgs.push(makeAssistantMsg(`A${i}`));
    }
    const result = snipMessages(msgs, { enabled: false });
    expect(result.applied).toBe(false);
    expect(result.messages).toEqual(msgs);
  });
});

// ========== 工具调用完整性 ==========

describe('snipMessages — 工具调用完整性', () => {
  test('有配对的 tool_result 的 tool_call 被保留', () => {
    const msgs: ChatMessage[] = [
      makeSystemMsg('System prompt'),
      makeUserMsg('Read a file'),
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call_1', function: { name: 'read_file', arguments: '{}' } },
        ],
      } as unknown as ChatMessage,
      makeToolResultMsg('call_1', 'File content here'),
      // 多余轮次以触发裁剪
      ...Array.from({ length: 8 }, (_, i) => [
        makeUserMsg(`Q${i}`),
        makeAssistantMsg(`A${i}`),
      ]).flat(),
    ];

    const result = snipMessages(msgs);
    // 工具结果应保留在结果中
    const toolResults = result.messages.filter(
      (m) => (m as unknown as Record<string, unknown>).tool_call_id === 'call_1'
    );
    expect(toolResults.length).toBe(1);
  });
});

// ========== 以 assistant 结尾的处理 ==========

describe('snipMessages — 尾消息修正', () => {
  test('以 assistant 结尾时追加 continue 消息', () => {
    // 只保留尾部：最后一个 user 之后没有内容，以 assistant 结尾
    const msgs: ChatMessage[] = [
      ...Array.from({ length: 9 }, (_, i) => [
        makeUserMsg(`Q${i}`),
        makeAssistantMsg(`A${i}`),
      ]).flat(),
      makeUserMsg('Q9'),
      makeAssistantMsg('A9'), // 以 assistant 结尾
    ];

    const result = snipMessages(msgs, { keepHeadTurns: 1, keepTailTurns: 3 });
    // ensureTrailingUserMessage 应在末尾追加 Continue.
    const lastMsg = result.messages[result.messages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toContain('Continue');
  });
});
