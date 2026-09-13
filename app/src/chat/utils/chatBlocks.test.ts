// Fix3（2026-09-05）：chatBlocks 读侧去重单测——消息内 + 跨消息归属去重
import { describe, expect, test } from 'bun:test';
import {
  dedupeToolCallBlocks,
  dedupeMessagesToolCallBlocks,
} from './chatBlocks.js';

const call = (
  id: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  type: 'tool_call',
  toolCallId: id,
  toolCall: { id, name: 'grep', arguments: { pattern: 'x' }, ...extra },
});

describe('dedupeToolCallBlocks（消息内去重）', () => {
  test('同 id 两块 → 合并为一块，保留首个非空 arguments', () => {
    const blocks = [call('c1'), call('c1', { status: 'completed' })];
    const out = dedupeToolCallBlocks(blocks);
    expect(out).toHaveLength(1);
    expect((out[0].toolCall as { status?: string }).status).toBe('completed');
    expect(
      (out[0].toolCall as { arguments?: { pattern: string } }).arguments
        ?.pattern
    ).toBe('x');
  });

  test('无重复 → 内容等价（含工具块时重建数组，内容不变）', () => {
    const blocks = [call('c1'), call('c2')];
    expect(dedupeToolCallBlocks(blocks)).toEqual(blocks);
  });

  test('无 tool_call 块 → 返回原数组引用（零副作用）', () => {
    const blocks = [
      { type: 'text', content: 'hello' },
      { type: 'status', content: 'thinking' },
    ];
    expect(dedupeToolCallBlocks(blocks)).toBe(blocks);
  });
});

describe('dedupeMessagesToolCallBlocks（Fix3 跨消息归属去重）', () => {
  test('同 call 跨两条消息 → 只归属首条，后续消息移除该块', () => {
    const messages = [
      { id: 'm1', blocks: [call('c1'), call('c2')] },
      { id: 'm2', blocks: [call('c3'), call('c1')] }, // c1 已在 m1 归属 → 移除
    ];
    const out = dedupeMessagesToolCallBlocks(messages);
    expect(out).toHaveLength(2);
    expect(out[0].blocks).toHaveLength(2); // c1,c2
    expect(out[1].blocks).toHaveLength(1); // c3（c1 去重）
    expect(out[1].blocks[0].toolCallId).toBe('c3');
  });

  test('消息内重复也折叠（189→186 场景）', () => {
    const messages = [
      { id: 'm1', blocks: [call('a1'), call('a1'), call('a2')] },
      { id: 'm2', blocks: [call('a2'), call('a3')] }, // a2 已归属 m1
    ];
    const out = dedupeMessagesToolCallBlocks(messages);
    expect(out[0].blocks).toHaveLength(2); // a1(合并), a2
    expect(out[1].blocks).toHaveLength(1); // a3
  });

  test('无重复 → 返回原数组引用', () => {
    const messages = [
      { id: 'm1', blocks: [call('c1')] },
      { id: 'm2', blocks: [call('c2')] },
    ];
    expect(dedupeMessagesToolCallBlocks(messages)).toBe(messages);
  });
});
