// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * U-06（2026-10-17）：长任务占位提示与 chunk 消费解耦。
 *
 * 锁定：静默期（无 chunk）也能在阈值到达时发送占位；正常结束不发；
 * onOutbound 失败不阻断主流程。
 */
import { describe, it, expect } from 'bun:test';
import { consumeStreamChunks } from '../../src/channels/routing/streamConsumption.js';
import type { ChatStreamChunk } from '../../src/runtime/api/CoreAPI.js';

function makeDeps(
  generator: AsyncGenerator<
    ChatStreamChunk,
    { content: string; finishReason?: string },
    unknown
  >,
  onOutbound?: (content: string, target: string) => Promise<void>
) {
  return {
    generator,
    cancelController: new AbortController(),
    executionManager: {
      requestCancel: () => undefined,
    } as never,
    lease: { executionId: 'exec-1', release: () => undefined } as never,
    message: {
      messageId: 'msg-1',
      senderId: 'user-1',
      conversationId: 'conv-1',
      content: 'hi',
    } as never,
    channelName: 'test',
    traceId: 'trace-1',
    enableLongTaskPlaceholder: true,
    onOutbound,
    llmStartMs: Date.now(),
    placeholderAfterMs: 20,
    finishExecution: () => undefined,
  };
}

function silentGenerator(delayMs: number) {
  return (async function* () {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return { content: 'done', finishReason: 'stop' };
  })() as AsyncGenerator<
    ChatStreamChunk,
    { content: string; finishReason?: string },
    unknown
  >;
}

describe('consumeStreamChunks 长任务占位', () => {
  it('静默期超过阈值 ⇒ 发送一次占位', async () => {
    const outbound: string[] = [];
    const result = await consumeStreamChunks(
      makeDeps(silentGenerator(40), async (content) => {
        outbound.push(content);
      })
    );
    expect(outbound.length).toBe(1);
    expect(outbound[0]).toContain('任务仍在执行中');
    expect(result.content).toBe('done');
  });

  it('流在阈值前结束 ⇒ 不发送占位', async () => {
    const outbound: string[] = [];
    await consumeStreamChunks(
      makeDeps(silentGenerator(0), async (content) => {
        outbound.push(content);
      })
    );
    expect(outbound).toEqual([]);
  });

  it('onOutbound 失败不阻断主流程', async () => {
    const result = await consumeStreamChunks(
      makeDeps(silentGenerator(40), async () => {
        throw new Error('send failed');
      })
    );
    expect(result.content).toBe('done');
  });
});
