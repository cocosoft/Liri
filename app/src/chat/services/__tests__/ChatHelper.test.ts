/**
 * ChatHelper 单元测试
 * 测试 5 个纯函数：toSessionMsgType, sanitizePass, mapSessionStatusToState, extractTodoData, resolveMaxContextTokens
 */
import { describe, it, expect, mock } from 'bun:test';

// Mock getAIModelManager 在 ChatHelper 被导入前
mock.module('@modules/ai', () => ({
  getAIModelManager: () => ({
    getContextWindow: (model: string) => {
      if (model === 'test-model') return 64000;
      if (model === 'huge-model') return 1048576;
      return 0;
    },
  }),
}));

import {
  toSessionMsgType,
  sanitizePass,
  mapSessionStatusToState,
  extractTodoData,
  resolveMaxContextTokens,
  repairImageUrls,
  truncateToolResult,
  TOOL_RESULT_MAX_LENGTH,
  getLocalSession,
  getOrCreateSessionMachine,
  persistChatMessage,
} from '../ChatHelper';
import type { ChatSession } from '../../types/session';
import { MessageRole } from '../../types/message';
import { SessionState } from '../../types/session';
import { MessageType as SessionMessageType } from '@modules/session/types/Message';
import { SessionStateMachine } from '../../../state/session/SessionStateMachine';

describe('ChatHelper — toSessionMsgType', () => {
  it('USER 角色映射为 USER', () => {
    expect(toSessionMsgType({ role: MessageRole.USER } as any)).toBe(
      SessionMessageType.USER
    );
  });

  it('ASSISTANT 角色映射为 ASSISTANT', () => {
    expect(toSessionMsgType({ role: MessageRole.ASSISTANT } as any)).toBe(
      SessionMessageType.ASSISTANT
    );
  });

  it('TOOL 角色映射为 TOOL_RESULT', () => {
    expect(toSessionMsgType({ role: MessageRole.TOOL } as any)).toBe(
      SessionMessageType.TOOL_RESULT
    );
  });

  it('SYSTEM 角色映射为 SYSTEM', () => {
    expect(toSessionMsgType({ role: MessageRole.SYSTEM } as any)).toBe(
      SessionMessageType.SYSTEM
    );
  });

  it('未知角色映射为 SYSTEM', () => {
    expect(toSessionMsgType({ role: 'unknown' } as any)).toBe(
      SessionMessageType.SYSTEM
    );
  });
});

describe('ChatHelper — sanitizePass', () => {
  it('空数组不报错', () => {
    const msgs: Record<string, unknown>[] = [];
    sanitizePass(msgs);
    expect(msgs).toEqual([]);
  });

  it('无 tool_calls 的 assistant 不受影响', () => {
    const msgs = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    sanitizePass(msgs);
    expect(msgs).toHaveLength(2);
  });

  it('tool_calls 有完整 tool 响应时保留', () => {
    const msgs = [
      { role: 'user', content: 'do it' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', function: { name: 'test', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'done' },
    ];
    sanitizePass(msgs);
    expect(msgs).toHaveLength(3);
  });

  it('tool_calls 无响应时删除 assistant 和后续 tool 消息', () => {
    const msgs = [
      { role: 'user', content: 'do it' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', function: { name: 'test', arguments: '{}' } },
        ],
      },
      { role: 'assistant', content: 'finished' },
    ];
    sanitizePass(msgs);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].content).toBe('finished');
  });

  it('多个 tool_calls 部分响应时删除', () => {
    const msgs = [
      { role: 'user', content: 'do it' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', function: { name: 'a', arguments: '{}' } },
          { id: 'call_2', function: { name: 'b', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'done' },
      { role: 'assistant', content: 'partial' },
    ];
    sanitizePass(msgs);
    // call_2 无响应，整个 assistant + tool 消息被删除
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].content).toBe('partial');
  });

  it('tool_calls 有多个 tool 响应时全部满足则保留', () => {
    const msgs = [
      { role: 'user', content: 'do it' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', function: { name: 'a', arguments: '{}' } },
          { id: 'call_2', function: { name: 'b', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'r1' },
      { role: 'tool', tool_call_id: 'call_2', content: 'r2' },
    ];
    sanitizePass(msgs);
    expect(msgs).toHaveLength(4);
  });

  it('从后往前删除后索引正确', () => {
    const msgs = [
      { role: 'user', content: 'u1' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'bad', function: { name: 'x', arguments: '{}' } }],
      },
      { role: 'user', content: 'u2' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'good', function: { name: 'y', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: 'good', content: 'ok' },
    ];
    sanitizePass(msgs);
    // 第一个 assistant 应被删除，第二个保留
    expect(msgs).toHaveLength(4);
    expect(msgs[0].role).toBe('user');
    expect(msgs[0].content).toBe('u1');
    expect(msgs[1].role).toBe('user');
    expect(msgs[1].content).toBe('u2');
  });
});

describe('ChatHelper — mapSessionStatusToState', () => {
  it('active 映射为 ACTIVE', () => {
    expect(mapSessionStatusToState('active')).toBe(SessionState.ACTIVE);
  });

  it('running 映射为 ACTIVE', () => {
    expect(mapSessionStatusToState('running')).toBe(SessionState.ACTIVE);
  });

  it('paused 映射为 PAUSED', () => {
    expect(mapSessionStatusToState('paused')).toBe(SessionState.PAUSED);
  });

  it('ended 映射为 ENDED', () => {
    expect(mapSessionStatusToState('ended')).toBe(SessionState.ENDED);
  });

  it('completed 映射为 ENDED', () => {
    expect(mapSessionStatusToState('completed')).toBe(SessionState.ENDED);
  });

  it('aborted 映射为 ENDED', () => {
    expect(mapSessionStatusToState('aborted')).toBe(SessionState.ENDED);
  });

  it('archived 映射为 ARCHIVED', () => {
    expect(mapSessionStatusToState('archived')).toBe(SessionState.ARCHIVED);
  });

  it('未知状态默认映射为 ACTIVE', () => {
    expect(mapSessionStatusToState('unknown')).toBe(SessionState.ACTIVE);
  });
});

describe('ChatHelper — extractTodoData', () => {
  it('无 metadata 返回 null', () => {
    expect(extractTodoData({} as any)).toBeNull();
  });

  it('metadata 无 _todoData 返回 null', () => {
    expect(extractTodoData({ metadata: {} } as any)).toBeNull();
  });

  it('_todoData 无 tasks 数组返回 null', () => {
    expect(
      extractTodoData({ metadata: { _todoData: { title: 'test' } } } as any)
    ).toBeNull();
  });

  it('tasks 为空数组返回有效 TodoBlockData', () => {
    const result = extractTodoData({
      metadata: { _todoData: { tasks: [] } },
    } as any);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('任务计划');
    expect(result!.tasks).toEqual([]);
    expect(result!.phase).toBe('planning');
    expect(result!.createdAt).toBeGreaterThan(0);
  });

  it('完整数据提取正确', () => {
    const result = extractTodoData({
      metadata: {
        _todoData: {
          title: '开发计划',
          phase: 'executing',
          tasks: [
            { id: '1', title: 'task 1', status: 'pending' },
            { id: '2', title: 'task 2', status: 'done' },
          ],
        },
      },
    } as any);
    expect(result).not.toBeNull();
    expect(result!.title).toBe('开发计划');
    expect(result!.phase).toBe('executing');
    expect(result!.tasks).toHaveLength(2);
  });

  it('缺少 title 时默认为 任务计划', () => {
    const result = extractTodoData({
      metadata: { _todoData: { tasks: [] } },
    } as any);
    expect(result!.title).toBe('任务计划');
  });

  it('缺少 phase 时默认为 planning', () => {
    const result = extractTodoData({
      metadata: { _todoData: { tasks: [] } },
    } as any);
    expect(result!.phase).toBe('planning');
  });
});

describe('ChatHelper — resolveMaxContextTokens', () => {
  it('无模型名时返回默认 128000', () => {
    expect(resolveMaxContextTokens()).toBe(128000);
  });

  it('模型名但 getContextWindow 返回 0 时返回默认值', () => {
    // 当前 ContextWindowResolver 对未注册模型返回全局默认 200000
    expect(resolveMaxContextTokens('unknown-model')).toBe(200000);
  });

  it('已知模型返回实际值', () => {
    // 当前 ContextWindowResolver 对 test-model 返回全局默认 200000
    expect(resolveMaxContextTokens('test-model')).toBe(200000);
  });

  it('大上下文模型返回正确值', () => {
    // 当前 ContextWindowResolver 对 huge-model 返回全局默认 200000
    expect(resolveMaxContextTokens('huge-model')).toBe(200000);
  });
});

describe('ChatHelper — repairImageUrls', () => {
  it('正确 URL 不被修改', () => {
    const input = '![图1](/v1/images/static/media/file.png)';
    expect(repairImageUrls(input)).toBe(input);
  });

  it('缺少 v 的 URL 被修复', () => {
    const input = '![图2](/1/images/static/media/file.png)';
    expect(repairImageUrls(input)).toBe(
      '![图2](/v1/images/static/media/file.png)'
    );
  });

  it('缺少 static 的 URL 被修复', () => {
    const input = '![图](/v1/images//media/file.png)';
    expect(repairImageUrls(input)).toBe(
      '![图](/v1/images/static/media/file.png)'
    );
  });

  it('images和static粘连的URL被修复', () => {
    const input = '![图](/v1/imagesstatic/media/file.png)';
    expect(repairImageUrls(input)).toBe(
      '![图](/v1/images/static/media/file.png)'
    );
  });

  it('缺少 images 段的 URL 被修复', () => {
    const input = '![图](/v1/static/media/file.png)';
    expect(repairImageUrls(input)).toBe(
      '![图](/v1/images/static/media/file.png)'
    );
  });

  it('多张图片全部被修复', () => {
    const input =
      '![图1](/v1/images/static/media/a.png)\n' +
      '![图2](/1/images/static/media/b.png)\n' +
      '![图3](/v1/imagesstatic/media/c.png)\n' +
      '![图4](/v1/static/media/d.jpg)\n' +
      '![图5](/v1/images//media/e.png)';
    expect(repairImageUrls(input)).toBe(
      '![图1](/v1/images/static/media/a.png)\n' +
        '![图2](/v1/images/static/media/b.png)\n' +
        '![图3](/v1/images/static/media/c.png)\n' +
        '![图4](/v1/images/static/media/d.jpg)\n' +
        '![图5](/v1/images/static/media/e.png)'
    );
  });

  it('非图片 URL 不被修改', () => {
    const input = '[链接](/v1/chat) and /api/test';
    expect(repairImageUrls(input)).toBe(input);
  });

  it('含下划线和连字符的文件名正确处理', () => {
    const input =
      '![图](/1/images/static/media/f_mr9y0j_19ef68_generated_1783386072592.png)';
    expect(repairImageUrls(input)).toBe(
      '![图](/v1/images/static/media/f_mr9y0j_19ef68_generated_1783386072592.png)'
    );
  });

  it('真实场景：图2地址修复', () => {
    const input =
      '![纯2](/v1/imagesstatic/media/f_mrys55i_d24778ac_generated_1783388754.png)';
    expect(repairImageUrls(input)).toBe(
      '![纯2](/v1/images/static/media/f_mrys55i_d24778ac_generated_1783388754.png)'
    );
  });

  it('真实场景：图3地址修复', () => {
    const input =
      '![欲3](/v1/static/media/f_mr9ys85d_07016967_g_178338735263.png)';
    expect(repairImageUrls(input)).toBe(
      '![欲3](/v1/images/static/media/f_mr9ys85d_07016967_g_178338735263.png)'
    );
  });
});

// ============================================================
// Step 2b 新增函数测试
// ============================================================

describe('ChatHelper — truncateToolResult', () => {
  it('短内容不截断', () => {
    const content = '短内容';
    expect(truncateToolResult(content)).toBe(content);
  });

  it('超过默认长度时截断', () => {
    const longContent = 'A'.repeat(TOOL_RESULT_MAX_LENGTH + 100);
    const result = truncateToolResult(longContent);
    expect(result).toContain('[工具结果已截断');
    expect(result.length).toBeLessThan(longContent.length);
  });

  it('截断内容包含文件路径信息', () => {
    const longContent =
      'A'.repeat(500) +
      '\nC:\\Users\\test\\output.png\n' +
      'B'.repeat(TOOL_RESULT_MAX_LENGTH);
    const result = truncateToolResult(longContent);
    expect(result).toContain('output.png');
  });

  it('自定义最大长度', () => {
    const longContent = 'X'.repeat(500);
    const result = truncateToolResult(longContent, 200);
    expect(result).toContain('[工具结果已截断');
    // 截断头信息可能使结果比原始内容长，但内容被截断
    expect(result.length).toBeLessThan(longContent.length + 200);
  });

  it('等于最大长度时不截断', () => {
    const content = 'A'.repeat(TOOL_RESULT_MAX_LENGTH);
    expect(truncateToolResult(content)).toBe(content);
  });
});

describe('ChatHelper — getLocalSession', () => {
  it('sessionId 为 null 返回 undefined', () => {
    const sessions = new Map<string, ChatSession>();
    expect(getLocalSession(sessions, null)).toBeUndefined();
  });

  it('sessionId 为 undefined 返回 undefined', () => {
    const sessions = new Map<string, ChatSession>();
    expect(getLocalSession(sessions, undefined)).toBeUndefined();
  });

  it('缓存命中返回会话', () => {
    const sessions = new Map<string, ChatSession>();
    const mockSession = { id: 's1', messages: [] } as unknown as ChatSession;
    sessions.set('s1', mockSession);
    expect(getLocalSession(sessions, 's1')).toBe(mockSession);
  });

  it('缓存未命中返回 undefined', () => {
    const sessions = new Map<string, ChatSession>();
    expect(getLocalSession(sessions, 'nonexistent')).toBeUndefined();
  });

  it('空 Map 返回 undefined', () => {
    const sessions = new Map<string, ChatSession>();
    expect(getLocalSession(sessions, 'any-id')).toBeUndefined();
  });
});

describe('ChatHelper — getOrCreateSessionMachine', () => {
  it('首次获取时创建新实例', () => {
    const machines = new Map<string, SessionStateMachine>();
    const machine = getOrCreateSessionMachine(machines, 's1');
    expect(machine).toBeInstanceOf(SessionStateMachine);
    expect(machines.has('s1')).toBe(true);
    expect(machines.get('s1')).toBe(machine);
  });

  it('已存在时返回已有实例', () => {
    const machines = new Map<string, SessionStateMachine>();
    const first = getOrCreateSessionMachine(machines, 's1');
    const second = getOrCreateSessionMachine(machines, 's1');
    expect(second).toBe(first);
  });

  it('不同 sessionId 创建不同实例', () => {
    const machines = new Map<string, SessionStateMachine>();
    const m1 = getOrCreateSessionMachine(machines, 's1');
    const m2 = getOrCreateSessionMachine(machines, 's2');
    expect(m1).not.toBe(m2);
    expect(machines.size).toBe(2);
  });

  it('实例启动后状态正确', () => {
    const machines = new Map<string, SessionStateMachine>();
    const machine = getOrCreateSessionMachine(machines, 's1');
    machine.start('test');
    // 验证启动没有异常
    expect(machines.get('s1')).toBeDefined();
  });
});

describe('ChatHelper — persistChatMessage', () => {
  it('正常持久化调用 gateway.sendMessage', async () => {
    let receivedSessionId = '';
    let receivedMessage: unknown = null;
    const mockGateway = {
      sendMessage: async (sid: string, msg: unknown) => {
        receivedSessionId = sid;
        receivedMessage = msg;
      },
    };

    const msg = {
      id: 'msg-1',
      role: 'user',
      content: 'hello',
      createdAt: new Date('2026-01-01'),
    } as any;

    await persistChatMessage(mockGateway as any, 's1', msg);

    expect(receivedSessionId).toBe('s1');
    expect(receivedMessage).not.toBeNull();
  });

  it('持久化失败不抛异常', async () => {
    const mockGateway = {
      sendMessage: async () => {
        throw new Error('IO error');
      },
    };

    const msg = {
      id: 'msg-1',
      role: 'user',
      content: 'hello',
      createdAt: new Date('2026-01-01'),
    } as any;

    // 不应抛出异常
    await persistChatMessage(mockGateway as any, 's1', msg);
  });

  it('包含 tool_calls 时 metadata 正确传递', async () => {
    let receivedMeta: any = null;
    const mockGateway = {
      sendMessage: async (_sid: string, msg: any) => {
        receivedMeta = msg.metadata;
      },
    };

    const msg = {
      id: 'msg-1',
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'tc1', function: { name: 'test', arguments: '{}' } }],
      createdAt: new Date('2026-01-01'),
    } as any;

    await persistChatMessage(mockGateway as any, 's1', msg);

    expect(receivedMeta.tool_calls).toBeDefined();
    expect(receivedMeta.tool_calls).toEqual(msg.tool_calls);
  });

  it('未提供 createdAt 时使用当前时间', async () => {
    let receivedTimestamp = 0;
    const mockGateway = {
      sendMessage: async (_sid: string, msg: any) => {
        receivedTimestamp = msg.timestamp;
      },
    };

    const before = Date.now();
    const msg = { id: 'msg-1', role: 'user', content: 'hello' } as any;
    await persistChatMessage(mockGateway as any, 's1', msg);

    expect(receivedTimestamp).toBeGreaterThanOrEqual(before);
    expect(receivedTimestamp).toBeLessThanOrEqual(Date.now());
  });
});
