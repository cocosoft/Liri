// chatBlocks 重写版单测（与源码同目录）
// 覆盖：消息内合并去重、跨消息归属去重、引用保持/零副作用、边界输入
import { describe, expect, test } from 'bun:test';
import {
  dedupeToolCallBlocks,
  dedupeMessagesToolCallBlocks,
} from './chatBlocks.js';

/** 构造 tool_call 块：顶层 toolCallId 字段（extra 展开进 toolCall 内） */
const call = (
  id: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  type: 'tool_call',
  toolCallId: id,
  toolCall: { id, name: 'grep', arguments: { pattern: 'x' }, ...extra },
});

/** 构造 tool_call 块：仅嵌套 toolCall.id（无顶层 toolCallId） */
const callNested = (
  id: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  type: 'tool_call',
  toolCall: { id, name: 'read', arguments: { path: '/' }, ...extra },
});

describe('dedupeToolCallBlocks（消息内去重）', () => {
  test('同 id 两块 → 合并为一块：终态字段取后到，arguments 保留首个非空', () => {
    const blocks = [call('c1'), call('c1', { status: 'completed' })];
    const out = dedupeToolCallBlocks(blocks);
    expect(out).toHaveLength(1);
    const tc = out[0].toolCall as {
      status?: string;
      arguments?: { pattern: string };
    };
    expect(tc.status).toBe('completed'); // tool_end 终态覆盖
    expect(tc.arguments?.pattern).toBe('x'); // tool_start 参数保留
  });

  test('首个 arguments 缺失时，取后到非空 arguments', () => {
    const blocks = [
      call('c1', { arguments: undefined }),
      call('c1', { status: 'running', arguments: { pattern: 'y' } }),
    ];
    const out = dedupeToolCallBlocks(blocks);
    expect(out).toHaveLength(1);
    const tc = out[0].toolCall as { arguments?: { pattern: string } };
    expect(tc.arguments?.pattern).toBe('y');
  });

  test('arguments 为空对象时被后到非空值覆盖', () => {
    const blocks = [
      call('c1', { arguments: {} }),
      call('c1', { status: 'running', arguments: { pattern: 'y' } }),
    ];
    const out = dedupeToolCallBlocks(blocks);
    expect(out).toHaveLength(1);
    const tc = out[0].toolCall as { arguments?: { pattern: string } };
    expect(tc.arguments?.pattern).toBe('y');
  });

  test('嵌套 toolCall.id（无顶层 toolCallId）同样可合并', () => {
    const blocks = [
      callNested('n1'),
      callNested('n1', { status: 'error', error: 'boom' }),
    ];
    const out = dedupeToolCallBlocks(blocks);
    expect(out).toHaveLength(1);
    const tc = out[0].toolCall as { error?: string; arguments?: object };
    expect(tc.error).toBe('boom');
    expect(Object.keys(tc.arguments ?? {}).length).toBeGreaterThan(0);
  });

  test('顶层 toolCallId 优先于嵌套 toolCall.id', () => {
    // 块 A：顶层 id 与嵌套 id 不同；块 B 顶层 id 同 A → 应合并（按顶层取）
    const a = {
      type: 'tool_call',
      toolCallId: 'top',
      toolCall: { id: 'inner', name: 'grep', arguments: { pattern: 'a' } },
    };
    const b = {
      type: 'tool_call',
      toolCallId: 'top',
      toolCall: { id: 'inner', name: 'grep', arguments: { pattern: 'b' } },
    };
    const out = dedupeToolCallBlocks([a, b]);
    expect(out).toHaveLength(1);
    expect((out[0].toolCall as { arguments?: object }).arguments).toEqual({
      pattern: 'a',
    });
  });

  test('三个重复块只输出一次且位于首个位置，非 tool_call 块保序保引用', () => {
    const text1 = { type: 'text', content: 'hello' };
    const text2 = { type: 'text', content: 'world' };
    const blocks = [
      text1,
      call('c1'),
      call('c1', { status: 'running' }),
      call('c1', { status: 'completed' }),
      text2,
    ];
    const out = dedupeToolCallBlocks(blocks);
    expect(out).toHaveLength(3); // text1 + 合并块 + text2
    expect(out[0]).toBe(text1);
    expect((out[1].toolCall as { status?: string }).status).toBe('completed');
    expect(out[2]).toBe(text2);
  });

  test('合并不修改输入块（toolCall 为浅拷贝），重复块为新建对象', () => {
    const first = call('c1');
    const second = call('c1', { status: 'done' });
    const blocks = [first, second];
    const out = dedupeToolCallBlocks(blocks);
    expect((first.toolCall as { status?: string }).status).toBeUndefined();
    expect((second.toolCall as { status?: string }).status).toBe('done');
    expect(out[0]).not.toBe(first);
    expect(out[0]).not.toBe(second);
    expect(out[0].toolCall).not.toBe(first.toolCall);
  });

  test('空 toolCallId 的 tool_call 块不合并、原引用保留；仅此一种块时返回原数组', () => {
    const orphan = { type: 'tool_call', toolCall: { arguments: {} } };
    const blocks = [orphan, orphan];
    const out = dedupeToolCallBlocks(blocks);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(orphan);
    expect(out).toBe(blocks); // merged.size === 0 → 原数组
  });

  test('无 tool_call 块 → 返回原数组引用（零副作用）', () => {
    const blocks = [{ type: 'text', content: 'a' }, { type: 'image' }];
    expect(dedupeToolCallBlocks(blocks)).toBe(blocks);
  });

  test('含工具块但互不重复 → 返回原数组引用（零副作用）', () => {
    const blocks = [call('c1'), call('c2')];
    expect(dedupeToolCallBlocks(blocks)).toBe(blocks);
  });
});

describe('dedupeMessagesToolCallBlocks（跨消息归属去重）', () => {
  test('同 call 跨两条消息 → 只归属首条，后续消息移除该块', () => {
    const messages = [
      { id: 'm1', blocks: [call('c1'), call('c2')] },
      { id: 'm2', blocks: [call('c3'), call('c1')] },
    ];
    const out = dedupeMessagesToolCallBlocks(messages);
    expect(out).toHaveLength(2);
    expect(out[0].blocks).toHaveLength(2); // c1, c2
    expect(out[1].blocks).toHaveLength(1); // c3（c1 已归属 m1）
    expect(out[1].blocks[0].toolCallId).toBe('c3');
  });

  test('消息内折叠与跨消息归属同时生效（189→186 场景）', () => {
    const messages = [
      { id: 'm1', blocks: [call('a1'), call('a1'), call('a2')] },
      { id: 'm2', blocks: [call('a2'), call('a3')] },
    ];
    const out = dedupeMessagesToolCallBlocks(messages);
    expect(out[0].blocks).toHaveLength(2); // a1(合并), a2
    expect(out[1].blocks).toHaveLength(1); // a3（a2 已归属 m1）
    expect(out[1].blocks[0].toolCallId).toBe('a3');
  });

  test('首条消息内折叠结果被带出（changed 为 false 也重建该消息）', () => {
    // m1: c1 重复 → 消息内折叠为 1；m2: 再次出现 c1 → 跨消息移除 → 整链触发
    const messages = [
      { id: 'm1', blocks: [call('c1'), call('c1')] },
      { id: 'm2', blocks: [call('c1')] },
    ];
    const out = dedupeMessagesToolCallBlocks(messages);
    expect(out).not.toBe(messages); // touched → 新数组
    expect(out[0].blocks).toHaveLength(1); // 折叠后的 c1 保留
    expect(out[1].blocks).toHaveLength(0); // c1 已归属 m1 → 移除
  });

  test('无 blocks / 空 blocks 的消息原样保留，整体无变更时返回原数组引用', () => {
    const m0 = { id: 'm0' } as {
      id: string;
      blocks?: Array<Record<string, unknown>>;
    };
    const m1 = { id: 'm1', blocks: [] as Array<Record<string, unknown>> };
    const messages = [m0, m1, { id: 'm2', blocks: [call('c1')] }];
    const out = dedupeMessagesToolCallBlocks(messages);
    expect(out[0]).toBe(m0);
    expect(out[1]).toBe(m1);
    expect(out).toBe(messages);
  });

  test('无任何跨消息重复 → 返回原数组引用', () => {
    const messages = [
      { id: 'm1', blocks: [call('c1')] },
      { id: 'm2', blocks: [call('c2')] },
    ];
    expect(dedupeMessagesToolCallBlocks(messages)).toBe(messages);
  });

  test('仅消息内折叠（无跨消息重复）→ 折叠提交，返回新数组且内容已去重', () => {
    const messages = [
      { id: 'm1', blocks: [call('c1'), call('c1', { status: 'completed' })] },
      { id: 'm2', blocks: [call('c2')] },
    ];
    const out = dedupeMessagesToolCallBlocks(messages);
    expect(out).not.toBe(messages); // 折叠 = 实际变更 → 提交，不再被静默丢弃
    expect(out[0].blocks).toHaveLength(1);
    expect((out[0].blocks[0].toolCall as { status?: string }).status).toBe(
      'completed'
    ); // 终态来自后到块
    expect(out[1]).toBe(messages[1]); // 未变更消息保持引用
  });

  test('同 call 跨三条消息 → 仅首条保留，后续均移除且顺序稳定', () => {
    const messages = [
      { id: 'm1', blocks: [call('c1'), call('c2')] },
      { id: 'm2', blocks: [call('c3'), call('c1'), call('c4')] },
      { id: 'm3', blocks: [call('c1'), call('c5')] },
    ];
    const out = dedupeMessagesToolCallBlocks(messages);
    expect(out[0]).toBe(messages[0]); // 首条无变更 → 原引用
    expect(out[1].blocks.map((b) => b.toolCallId)).toEqual(['c3', 'c4']);
    expect(out[2].blocks.map((b) => b.toolCallId)).toEqual(['c5']);
  });

  test('跨消息移除仅删 tool_call，非 tool_call 块原样保留', () => {
    const text = { type: 'text', content: 'hi' };
    const messages = [
      { id: 'm1', blocks: [call('c1')] },
      { id: 'm2', blocks: [text, call('c1'), call('c9')] },
    ];
    const out = dedupeMessagesToolCallBlocks(messages);
    expect(out[1].blocks).toHaveLength(2);
    expect(out[1].blocks[0]).toBe(text);
    expect(out[1].blocks[1].toolCallId).toBe('c9');
  });

  test('消息内折叠先于归属判定：折叠后仍被后续消息引用 → 后续引用移除', () => {
    const messages = [
      { id: 'm1', blocks: [call('a1'), call('a1')] }, // 消息内折叠 → a1 归属 m1
      { id: 'm2', blocks: [call('a1'), call('b2')] }, // a1 已归属 → 移除
    ];
    const out = dedupeMessagesToolCallBlocks(messages);
    expect(out[0].blocks).toHaveLength(1);
    expect(out[1].blocks.map((b) => b.toolCallId)).toEqual(['b2']);
  });

  test('空 toolCallId 孤儿块不参与归属：跨消息重复各自保留，无变更原引用', () => {
    const orphan = { type: 'tool_call', toolCall: { arguments: {} } };
    const messages = [
      { id: 'm1', blocks: [orphan] },
      { id: 'm2', blocks: [orphan, call('c1')] },
    ];
    expect(dedupeMessagesToolCallBlocks(messages)).toBe(messages);
  });

  test('后续消息 tool 块被清空后，非 tool 块仍保留', () => {
    const text = { type: 'text', content: 'ok' };
    const messages = [
      { id: 'm1', blocks: [call('x1')] },
      { id: 'm2', blocks: [call('x1'), text] },
    ];
    const out = dedupeMessagesToolCallBlocks(messages);
    expect(out[1].blocks).toEqual([text]);
  });
});
