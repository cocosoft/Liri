// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2-1o（U-18 收尾切片，2026-10-17）：apiMessages 构建段（async generator）单测。
 *
 * 覆盖：构建成功不产中间 chunk / 返回值即构建结果 / 历史污染清洗在返回前生效 /
 * 构建失败先产 error status chunk 再抛错（chunk 顺序不变量）。
 */
import { describe, expect, it } from 'bun:test';
import { buildStreamApiMessages } from '../../../src/chat/orchestrator/streamMessageApiMessagesBuild';
import type { ChatStreamChunk } from '../../../src/runtime/api/CoreAPI';
import type { Message } from '../../../src/session/types/message';

const NO_MESSAGES: Message[] = [];

async function collect(
  gen: ReturnType<typeof buildStreamApiMessages>
): Promise<{ chunks: ChatStreamChunk[]; value: unknown }> {
  const chunks: ChatStreamChunk[] = [];
  let next = await gen.next();
  while (!next.done) {
    chunks.push(next.value);
    next = await gen.next();
  }
  return { chunks, value: next.value };
}

describe('buildStreamApiMessages', () => {
  it('构建成功 ⇒ 无中间 chunk，返回构建结果', async () => {
    const built = [{ role: 'user', content: 'hi' }];
    const { chunks, value } = await collect(
      buildStreamApiMessages({
        sessionId: 's1',
        messages: NO_MESSAGES,
        preCompacted: false,
        maxContextTokens: 128_000,
        maxTokens: 4096,
        buildApiMessages: async () => built,
      })
    );
    expect(chunks).toEqual([]);
    expect(value).toEqual(built);
  });

  it('构建产物含历史污染 ⇒ 返回清洗后的消息（空 assistant 丢弃 + 连续 assistant 合并）', async () => {
    const { value } = await collect(
      buildStreamApiMessages({
        sessionId: 's2',
        messages: NO_MESSAGES,
        preCompacted: true,
        maxContextTokens: 64_000,
        buildApiMessages: async () => [
          { role: 'user', content: 'q' },
          { role: 'assistant', content: 'a1' },
          { role: 'assistant', content: 'a2' },
          { role: 'assistant', content: '' },
        ],
      })
    );
    expect(value).toEqual([
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a1\na2' },
    ]);
  });

  it('构建失败 ⇒ 先产 error status chunk，再抛错', async () => {
    const gen = buildStreamApiMessages({
      sessionId: 's3',
      messages: NO_MESSAGES,
      preCompacted: false,
      maxContextTokens: 64_000,
      buildApiMessages: async () => {
        throw new Error('boom');
      },
    });
    const first = await gen.next();
    expect(first.done).toBe(false);
    const chunk = first.value as ChatStreamChunk;
    expect(chunk.type).toBe('status');
    expect(chunk.statusType).toBe('compaction');
    expect(chunk.phase).toBe('error');
    expect(String(chunk.content)).toContain('boom');
    await expect(gen.next()).rejects.toThrow('上下文构建失败：boom');
  });
});
