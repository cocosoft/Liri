/**
 * TAOR 适配器 `persistMessages`：声明落盘契约（2026-11-09）
 *
 * 真机 `session_mw915f24d7844a40ce` 暴露三类历史污染，本用例逐条锁定：
 *  1. 同一轮 assistant 被外层与 TAOR 各落一份（同 id 重复声明）⇒ 按 call id 归并判重；
 *  2. 空正文 + `tool_calls` 的声明不落盘 ⇒ 其工具结果在历史里无主，回放被剥离；
 *  3. 内联 `<think>` 作为可见正文落盘 ⇒ 回放时等于示范"只输出思考"。
 */
import { describe, expect, it } from 'bun:test';

import {
  createChatManagerTAORDeps,
  type ChatManagerTAORContext,
} from '@modules/query/ChatManagerTAORAdapter.js';
import type { ChatMessage } from '../../src/ai/models/types.js';

interface Persisted {
  content: string;
  metadata?: Record<string, unknown>;
}

function makeDeps(seedToolCallIds?: string[]) {
  const persisted: Persisted[] = [];
  const ctx = {
    sessionId: 'sess-persist',
    seedToolCallIds,
    sendModelRequest: async () => ({ content: '', stop_reason: 'stop' }),
    executeTools: async () => [],
    persistMessage: (
      _sid: string,
      content: string,
      _role: string,
      _toolCallId?: string,
      metadata?: Record<string, unknown>
    ) => {
      persisted.push({ content, metadata });
    },
    toolDefinitions: [],
    toolRegistry: { getTool: () => undefined },
    pendingInteractions: new Map(),
  } as unknown as ChatManagerTAORContext;
  const deps = createChatManagerTAORDeps(ctx);
  return { deps, persisted };
}

const assistantToolCall = (id: string, content = ''): ChatMessage => ({
  role: 'assistant',
  content,
  tool_calls: [
    {
      id,
      type: 'function',
      function: { name: 'file_read', arguments: '{"file_path":"a.txt"}' },
    },
  ],
});

describe('TAOR persistMessages 的声明落盘契约', () => {
  it('种子轮声明（外层已落盘）按 call id 判重，不再重复落盘', async () => {
    const { deps, persisted } = makeDeps(['call_seed']);
    await deps.persistMessages(
      [assistantToolCall('call_seed', '<think>种子思考</think>')],
      new AbortController().signal
    );
    expect(persisted).toHaveLength(0);
  });

  it('非种子轮：空正文 + tool_calls 也必须落盘（否则工具结果无主）', async () => {
    const { deps, persisted } = makeDeps();
    await deps.persistMessages(
      [assistantToolCall('call_round2', '<think>只想了没说话</think>')],
      new AbortController().signal
    );
    expect(persisted).toHaveLength(1);
    // 内联思考不得作为可见正文落盘
    expect(persisted[0].content).toBe('');
    expect(
      (persisted[0].metadata?.tool_calls as Array<{ id: string }>)[0].id
    ).toBe('call_round2');
  });

  it('纯思考、无声明的回合不落盘（避免空 assistant 消息堆积）', async () => {
    const { deps, persisted } = makeDeps();
    await deps.persistMessages(
      [assistantToolCall('x')].map((m) => ({
        ...m,
        tool_calls: undefined,
        content: '<think>只有思考</think>',
      })),
      new AbortController().signal
    );
    expect(persisted).toHaveLength(0);
  });

  it('清洗内联思考后保留可见正文', async () => {
    const { deps, persisted } = makeDeps();
    await deps.persistMessages(
      [{ role: 'assistant', content: '<think>推理</think>最终答案' }],
      new AbortController().signal
    );
    expect(persisted).toHaveLength(1);
    expect(persisted[0].content).toBe('最终答案');
  });
});
