/**
 * TAOR 适配器：`callModel` 必须按**单数** `toolCall` 逐块 yield 工具调用
 *
 * 2026-11-09（真机 `session_mw90qvsv11cd12eebc`）：非流式 chat 的工具轮，
 * `ChatManagerTAORAdapter.callModel` 曾把一个 `{tool_calls: [...]}`（复数）整块 yield，
 * 而 `TAORLoop._collectCallModel` 只按 `chunk.toolCall` 聚合 ⇒ 除 seed 轮外每一轮
 * 工具调用都被结构性丢弃：
 *
 *   模型请求 file_read → toolCalls 变空 → 误判「空回复」重试 → 兜底文案
 *   （`taorLoop:incomplete_turn_retry kind="empty"`，`executeTools` 永不触达）
 *
 * 本用例锁 chunk 契约（单数 `toolCall` + `usage` 在 `done` 之前），防止回归。
 */
import { describe, expect, it } from 'bun:test';

import {
  createChatManagerTAORDeps,
  type ChatManagerTAORContext,
} from '@modules/query/ChatManagerTAORAdapter.js';
import type { ChatMessage } from '../../src/ai/models/types.js';

function makeCtx(content: string): ChatManagerTAORContext {
  return {
    sessionId: 'sess-callmodel-toolcalls',
    sendModelRequest: async () => ({
      content,
      stop_reason: 'tool_calls',
      tool_calls: [
        { id: 'call_1', name: 'file_read', arguments: { file_path: 'a.txt' } },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    }),
    executeTool: async () => ({ toolCallId: 'call_1' }),
    persistMessage: () => {},
    toolDefinitions: [],
    toolRegistry: { getTool: () => undefined },
    pendingInteractions: new Map(),
  } as unknown as ChatManagerTAORContext;
}

async function collect(
  content: string
): Promise<Array<Record<string, unknown>>> {
  const deps = createChatManagerTAORDeps(makeCtx(content));
  const chunks: Array<Record<string, unknown>> = [];
  const messages: ChatMessage[] = [{ role: 'user', content: '读 a.txt' }];
  for await (const chunk of deps.callModel(
    messages,
    new AbortController().signal
  )) {
    chunks.push(chunk as unknown as Record<string, unknown>);
  }
  return chunks;
}

describe('TAOR 适配器 callModel 的 chunk 契约', () => {
  it('工具调用以单数 toolCall 逐块 yield（复数 tool_calls 不被聚合层识别）', async () => {
    const chunks = await collect('');
    const toolChunks = chunks.filter((c) => c.toolCall);
    expect(toolChunks).toHaveLength(1);
    expect((toolChunks[0].toolCall as { id: string; name: string }).id).toBe(
      'call_1'
    );
    expect((toolChunks[0].toolCall as { name: string }).name).toBe('file_read');
    // 复数形态不得再出现：聚合层不看它，出现即说明回到了旧写法
    expect(chunks.some((c) => Array.isArray(c.tool_calls))).toBe(false);
  });

  it('真实输入量在 done 之前以独立 usage 块回传', async () => {
    const chunks = await collect('');
    const usageIdx = chunks.findIndex(
      (c) => (c.usage as { prompt_tokens?: number })?.prompt_tokens === 12
    );
    const doneIdx = chunks.findIndex((c) => c.type === 'done');
    expect(usageIdx).toBeGreaterThanOrEqual(0);
    expect(doneIdx).toBeGreaterThan(usageIdx);
  });

  it('有可见正文时照常 yield text 块（无正文则不产出空块）', async () => {
    expect((await collect('读好了')).some((c) => c.content === '读好了')).toBe(
      true
    );
    expect((await collect('')).some((c) => c.type === 'text')).toBe(false);
  });
});
