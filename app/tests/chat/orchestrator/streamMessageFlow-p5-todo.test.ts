// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// P5 回归测试（2026-09-17）：
//   未消费 todo 补偿/flush——getPendingTodos 取走即清空，心跳循环 `if (done) break`
//   提前退出时（:1978 break 早于 :2055 消费点）最后一批已 push 的 todo 随 loop 丢弃。
//   修复：:2146 循环 flush 残留——落盘 assistant/todo + yield todo chunk。
//
//   测试策略：假 loop 的 run() 立即 done（触发 :1978 break，绕开 :2055 消费点），
//   getPendingTodos() 返回待消费 todo → 断言 flush 落盘 + 前端 chunk 均产出。

import { describe, expect, it, mock } from 'bun:test';
import { createTestHost } from './helpers';
import type { ChatOrchestratorHost } from '../../../src/chat/orchestrator/ChatOrchestrator.js';
import type { ChatResponse, ToolAwareClient } from '@modules/ai';

// 假 loop：run() 立即结束 → L1978 `if (done) break` → 进入 P5 flush（L2146）
const fakeLoop = {
  async *run(): AsyncGenerator<never, void, unknown> {
    // 立即结束
  },
  getHeartbeatData: () => ({
    completedToolNames: [],
    totalCompletedToolCount: 0,
  }),
  getPendingTodos: () => [
    {
      title: 't',
      phase: 'pending',
      tasks: [{ id: 't1', name: 'n', status: 'todo', dependsOn: [] }],
    },
  ],
  getAssistantMessage: () => ({ id: 'm', metadata: {} }),
  getTerminationTip: () => null,
};

// 必须先于 streamMessageFlow 模块求值注册（其 L1901 动态 import '../createAgentLoop.js'）
mock.module('@modules/chat/createAgentLoop', () => ({
  createChatAgentLoop: () => fakeLoop,
}));

const { runStreamMessage } =
  await import('../../../src/chat/orchestrator/streamMessageFlow.js');

/** 收集 appendStreamEvent 写入的事件列表 */
function collectEvents(
  host: ChatOrchestratorHost
): Array<{ type: string; data: unknown }> {
  const events: Array<{ type: string; data: unknown }> = [];
  (host as { appendStreamEvent: unknown }).appendStreamEvent = async (
    _sid: string,
    ev: { type: string; data: unknown }
  ) => {
    events.push({ type: ev.type, data: ev.data });
    return { ok: true, tailSeq: events.length };
  };
  return events;
}

/** 返回含 tool_calls 的 ChatResponse 的 LLM client（进门控 L1775） */
function createToolCallClient(): ToolAwareClient {
  return {
    streamMessage: () =>
      (async function* (): AsyncGenerator<never, ChatResponse, unknown> {
        return {
          content: '',
          role: 'assistant',
          id: '',
          tool_calls: [{ id: 'tc1', name: 'file_read', arguments: {} }],
        } as unknown as ChatResponse;
      })(),
    sendMessage: async () =>
      ({ content: '', role: 'assistant', id: '' }) as unknown as ChatResponse,
    getProviderId: () => 'test-provider',
    getBaseUrl: () => 'http://localhost:test',
  } as unknown as ToolAwareClient;
}

describe('P5: done 提前 break 后待消费 todo 经 flush 落盘+产出 chunk', () => {
  it('flush 写入 assistant/todo 事件并 yield todo chunk', async () => {
    const llmClient = createToolCallClient();
    const host = createTestHost({
      getLLMClient: () => llmClient,
      getClientForModel: () => llmClient,
      startRollbackRound: async () => {},
      endRollbackRound: async () => {},
    });
    const events = collectEvents(host);
    const received: unknown[] = [];

    for await (const chunk of runStreamMessage(host, '测试', {})) {
      received.push(chunk);
    }

    // ① flush 落盘：assistant/todo 事件，taskCard.title='t'、status='pending'
    const todoEvents = events.filter((e) => e.type === 'assistant/todo');
    expect(todoEvents.length).toBe(1);
    const data = todoEvents[0].data as {
      action: string;
      taskCard: { title: string; status: string; tasks: unknown[] };
    };
    expect(data.action).toBe('write');
    expect(data.taskCard.title).toBe('t');
    expect(data.taskCard.status).toBe('pending');
    expect(data.taskCard.tasks).toEqual([
      { id: 't1', name: 'n', status: 'todo', dependsOn: [] },
    ]);

    // ② 前端 chunk：含 {type:'todo'} 且 content 为 todoData JSON
    const todoChunks = received.filter(
      (c) => (c as { type?: string }).type === 'todo'
    );
    expect(todoChunks.length).toBe(1);
    const todoChunk = todoChunks[0] as { content: string; todoData: unknown };
    expect(todoChunk.todoData).toBeDefined();
    expect(JSON.parse(todoChunk.content)).toMatchObject({ title: 't' });
  });
});
