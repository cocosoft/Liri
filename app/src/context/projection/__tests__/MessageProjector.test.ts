/**
 * MessageProjector 单元测试
 *
 * 覆盖：
 * - 完整配对不注入占位
 * - 无配对 tool_call 注入占位
 * - 孤立 tool 消息剥离
 * - 缺失 tool_call id 补全
 * - 安全截断不切断 tool 对
 */
import { describe, test, expect } from 'bun:test';
import { MessageProjector } from '../MessageProjector';
import type { ChatMessage } from '@modules/ai';

const projector = new MessageProjector();

function makeUserMsg(content: string): ChatMessage {
  return { role: 'user', content } as ChatMessage;
}

function makeAssistantWithTools(
  calls: Array<{ id: string; name: string }>
): ChatMessage {
  return {
    role: 'assistant',
    content: '',
    tool_calls: calls.map((c) => ({
      id: c.id,
      type: 'function',
      function: { name: c.name, arguments: '{}' },
    })),
  } as ChatMessage;
}

function makeToolResultMsg(callId: string, content: string): ChatMessage {
  return { role: 'tool', tool_call_id: callId, content } as ChatMessage;
}

// ========== repairToolResultPairing ==========

describe('repairToolResultPairing', () => {
  test('完整配对不注入占位、不剥离', () => {
    const messages = [
      makeAssistantWithTools([{ id: 'call-1', name: 'read_file' }]),
      makeToolResultMsg('call-1', 'file content'),
    ];
    const result = projector.repairToolResultPairing(messages);
    expect(result.messages).toHaveLength(2);
    expect(result.warnings).toHaveLength(0);
  });

  test('无配对结果的 tool_call 注入占位', () => {
    const messages = [
      makeAssistantWithTools([{ id: 'call-1', name: 'read_file' }]),
      makeUserMsg('next turn'),
    ];
    const result = projector.repairToolResultPairing(messages);
    // assistant + 注入的 tool 占位 + user
    expect(result.messages).toHaveLength(3);
    const injected = result.messages[1];
    expect(injected?.role).toBe('tool');
    expect(injected?.tool_call_id).toBe('call-1');
    expect(injected?.content).toBe('[result truncated]');
    expect(result.warnings.some((w) => w.code === 'injected_tool_result')).toBe(
      true
    );
  });

  test('孤立 tool 消息被剥离', () => {
    const messages = [
      makeUserMsg('hello'),
      makeToolResultMsg('call-orphan', 'stray result'),
    ];
    const result = projector.repairToolResultPairing(messages);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.role).toBe('user');
    expect(
      result.warnings.some((w) => w.code === 'stripped_orphan_result')
    ).toBe(true);
  });

  test('缺失 id 的 tool_call 补全', () => {
    const msg = makeAssistantWithTools([{ id: 'call-1', name: 'read_file' }]);
    delete (msg.tool_calls as Array<{ id?: string }>)[0]?.id;
    const result = projector.repairToolResultPairing([msg]);
    const calls = result.messages[0]?.tool_calls;
    expect(calls?.[0]?.id).toMatch(/^z-ext-proj-/);
  });

  test('部分配对的 tool_call 只注入缺失部分', () => {
    const messages = [
      makeAssistantWithTools([
        { id: 'call-1', name: 'read_file' },
        { id: 'call-2', name: 'grep' },
      ]),
      makeToolResultMsg('call-1', 'content'),
    ];
    const result = projector.repairToolResultPairing(messages);
    const toolMsgs = result.messages.filter((m) => m.role === 'tool');
    // call-1 原结果 + call-2 注入占位（顺序不保证，按 tool_call_id 校验）
    expect(toolMsgs).toHaveLength(2);
    const byCallId = new Map(toolMsgs.map((m) => [m.tool_call_id, m.content]));
    expect(byCallId.get('call-1')).toBe('content');
    expect(byCallId.get('call-2')).toBe('[result truncated]');
  });

  test('预存#2/#3：内部格式 tool_calls（无 function 包裹）归一为 OpenAI 结构且不崩', () => {
    // 历史恢复/非流首响应补入上下文的内部格式：{id, name, arguments}
    const messages = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call-inner', name: 'todo_write', arguments: { step: 1 } },
        ],
      } as unknown as ChatMessage,
      makeToolResultMsg('call-inner', 'ok'),
    ];
    const result = projector.repairToolResultPairing(messages);
    const calls = result.messages[0]?.tool_calls;
    expect(calls?.[0]).toEqual({
      id: 'call-inner',
      type: 'function',
      function: { name: 'todo_write', arguments: '{"step":1}' },
    });
    // 配对工具消息保留（占位路径不再读 call.function.name 崩溃）
    expect(result.messages.some((m) => m.role === 'tool')).toBe(true);
    expect(result.warnings.some((w) => w.code === 'injected_tool_result')).toBe(
      false
    );
  });

  test('预存#2：tool 消息出现在对应 assistant 声明之前 → 顺序敏感剥离', () => {
    const messages = [
      makeToolResultMsg('call-late', '结果却排在前面'), // 声明在后 → 视为孤立
      makeAssistantWithTools([{ id: 'call-late', name: 'read' }]),
    ];
    const result = projector.repairToolResultPairing(messages);
    // 首条"超前"tool 被剥离（stripped_orphan_result）；assistant 声明保留并
    // 因缺真实结果自动注入占位 tool（配对完整性维持，防 provider 400）
    expect(result.messages[0]?.role).toBe('assistant');
    const toolMsgs = result.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(1);
    expect(toolMsgs[0]?.content).toBe('[result truncated]');
    expect(
      result.warnings.some((w) => w.code === 'stripped_orphan_result')
    ).toBe(true);
  });
});

// ========== toolPairSafeTruncate ==========

describe('toolPairSafeTruncate', () => {
  test('不超限不截断', () => {
    const messages = [
      makeUserMsg('a'),
      makeUserMsg('b'),
      makeAssistantWithTools([{ id: 'c1', name: 'x' }]),
      makeToolResultMsg('c1', 'r'),
    ];
    const result = projector.toolPairSafeTruncate(messages, 10);
    expect(result.messages).toHaveLength(4);
    expect(result.warnings).toHaveLength(0);
  });

  test('截断不切断 tool 对（整块保留）', () => {
    const messages = [
      makeUserMsg('u0'),
      makeAssistantWithTools([{ id: 'c1', name: 'read' }]),
      makeToolResultMsg('c1', 'r1'),
      makeUserMsg('u1'),
      makeUserMsg('u2'),
    ];
    // 需丢弃 2 条；u0 + tool 块(2) 若整块丢则超预算 → 保留块，只丢 u0
    const result = projector.toolPairSafeTruncate(messages, 3);
    expect(result.messages.length).toBeLessThanOrEqual(5);
    // tool 块内部配对必须完整（assistant 与紧随其后的 tool 都在）
    const hasAssistant = result.messages.some(
      (m) => m.role === 'assistant' && m.tool_calls?.length
    );
    const hasTool = result.messages.some((m) => m.role === 'tool');
    expect(hasAssistant).toBe(hasTool);
  });

  test('预算足够整块丢弃时整块丢弃', () => {
    const messages = [
      makeUserMsg('u0'),
      makeAssistantWithTools([{ id: 'c1', name: 'read' }]),
      makeToolResultMsg('c1', 'r1'),
      makeUserMsg('u1'),
    ];
    // maxMessages=2：丢弃 u0 + tool 块(2 条)
    const result = projector.toolPairSafeTruncate(messages, 2);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.role).toBe('user');
  });
});

// ========== project 组合 ==========

describe('project', () => {
  test('组合入口先修复再截断', () => {
    const messages = [
      makeUserMsg('u0'),
      makeAssistantWithTools([{ id: 'c1', name: 'read' }]), // 无配对
      makeUserMsg('u1'),
    ];
    const result = projector.project(messages, { maxMessages: 2 });
    // 修复注入占位后共 4 条，截断到 2
    expect(result.messages.length).toBeLessThanOrEqual(2);
  });
});
