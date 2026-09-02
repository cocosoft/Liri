// MIT License
// Copyright (c) 2026 190615273@qq.com
// 派生器单元测试：事件聚合 + 投影覆盖 + 排序（Phase 2 P2-1/P2-4）

import { describe, expect, it } from 'bun:test';
import { deriveMessagesFromEvents } from '../../src/session/storage/EventMessageDeriver';
import type { LiriEvent } from '../../src/chat/types/events';
import type { DerivedMessage } from '../../src/session/storage/EventMessageDeriver';

function ev(
  seq: number,
  type: LiriEvent['type'],
  data: Record<string, unknown>
): LiriEvent {
  return {
    type: type as never,
    schemaVersion: 1,
    seq,
    time: 1700000000000 + seq * 1000,
    sessionId: 's1',
    data: data as never,
  };
}

function proj(
  id: string,
  content: string,
  lastEventSeq?: number
): DerivedMessage {
  return { id, role: 'assistant', content, timestamp: 1, lastEventSeq };
}

describe('deriveMessagesFromEvents', () => {
  it('v1 事件按 messageId 归组聚合 text/thinking/tool_call', () => {
    const events: LiriEvent[] = [
      ev(1, 'user/message', { content: '你好', messageId: 'msg-1' }),
      ev(2, 'turn/start', { turn: 1 }),
      ev(3, 'assistant/thinking', { content: '思考', messageId: 'msg-2' }),
      ev(4, 'assistant/text', { content: '你好，', messageId: 'msg-2' }),
      ev(5, 'assistant/text', { content: '我是 Liri', messageId: 'msg-2' }),
      ev(6, 'assistant/tool_call', {
        toolCallId: 'tc-1',
        name: 'file_read',
        args: { path: '/a' },
        messageId: 'msg-2',
        callSeq: 6,
      }),
    ];
    const messages = deriveMessagesFromEvents(events, []);
    expect(messages.length).toBe(2);

    const user = messages.find((m) => m.id === 'msg-1');
    expect(user?.role).toBe('user');
    expect(user?.content).toBe('你好');

    const asst = messages.find((m) => m.id === 'msg-2');
    expect(asst?.content).toBe('你好，我是 Liri');
    // FIX(2026-08-23)：text/thinking 流式 delta 合并到相邻同类型 block——
    // 两个 text chunk 合并为 1 块，最终 thinking / text(合并) / tool_call 共 3 块
    const types = asst?.blocks?.map((b) => b.type);
    expect(types).toEqual(['thinking', 'text', 'tool_call']);
    const textBlock = asst?.blocks?.find((b) => b.type === 'text');
    expect(textBlock?.content).toBe('你好，我是 Liri');
    expect(asst?.tool_calls?.[0]?.id).toBe('tc-1');
  });

  it('F-2 聚合批事件 assistant/text-batch 与逐条 text 按 seq 展开语义一致', () => {
    const events: LiriEvent[] = [
      ev(1, 'user/message', { content: 'hi', messageId: 'msg-1' }),
      ev(2, 'turn/start', { turn: 1 }),
      ev(3, 'assistant/text', { content: '第一段', messageId: 'msg-2' }),
      ev(4, 'assistant/text-batch', { content: '第二段（聚合批）', messageId: 'msg-2' }),
      ev(5, 'assistant/text-batch', { content: '第三段', messageId: 'msg-2' }),
    ];
    const messages = deriveMessagesFromEvents(events, []);
    const asst = messages.find((m) => m.id === 'msg-2');
    // 内容按 seq 顺序全量拼接（所见即所存）
    expect(asst?.content).toBe('第一段第二段（聚合批）第三段');
    // 相邻 text/text-batch 合并为单个 text block（不碎片化）
    const types = asst?.blocks?.map((b) => b.type);
    expect(types).toEqual(['text']);
    const textBlock = asst?.blocks?.find((b) => b.type === 'text');
    expect(textBlock?.content).toBe('第一段第二段（聚合批）第三段');
  });

  it('D-1 session/summary 事件不派生消息、不影响消息计数（检索/日志用）', () => {
    const events: LiriEvent[] = [
      ev(1, 'user/message', { content: 'hi', messageId: 'm1' }),
      ev(2, 'assistant/text', { content: '答', messageId: 'm2' }),
      ev(3, 'session/summary', {
        content: '此前完成 AI-AGENT 前沿动态调研并产出 HTML 日报',
        keywords: ['AI-AGENT', '日报'],
        sourceEventSeqs: [1, 2],
      }),
    ];
    const messages = deriveMessagesFromEvents(events, []);
    expect(messages.length).toBe(2); // user + assistant（摘要不派生消息）
    const allText = JSON.stringify(messages);
    expect(allText).not.toContain('HTML 日报');
  });

  it('投影 lastEventSeq ≥ maxChunkSeq 时用投影覆盖（省拼接）', () => {
    const events: LiriEvent[] = [
      ev(1, 'assistant/text', { content: '旧内容', messageId: 'msg-2' }),
      ev(2, 'assistant/text', { content: '补充', messageId: 'msg-2' }),
    ];
    const projections = [proj('msg-2', '投影完整内容', 5)];
    const messages = deriveMessagesFromEvents(events, projections);
    const asst = messages.find((m) => m.id === 'msg-2');
    expect(asst?.content).toBe('投影完整内容');
    // 投影覆盖时 blocks 用投影的（无 events 拼块）
    expect(asst?.blocks?.length ?? 0).toBe(0);
  });

  it('投影旧（lastEventSeq < maxChunkSeq）时保留 events 聚合', () => {
    const events: LiriEvent[] = [
      ev(1, 'assistant/text', { content: '新内容', messageId: 'msg-2' }),
    ];
    const projections = [proj('msg-2', '旧投影', 0)];
    const messages = deriveMessagesFromEvents(events, projections);
    const asst = messages.find((m) => m.id === 'msg-2');
    expect(asst?.content).toBe('新内容');
  });

  it('纯投影消息（events 无 chunk）直接取投影', () => {
    const events: LiriEvent[] = [];
    const projections = [proj('msg-9', '纯投影消息', 10)];
    const messages = deriveMessagesFromEvents(events, projections);
    expect(messages.length).toBe(1);
    expect(messages[0].content).toBe('纯投影消息');
  });

  it('排序：首事件 seq 升序，纯投影按 lastEventSeq 插入', () => {
    const events: LiriEvent[] = [
      ev(10, 'assistant/text', { content: 'B', messageId: 'msg-b' }),
      ev(2, 'assistant/text', { content: 'A', messageId: 'msg-a' }),
    ];
    const projections = [proj('msg-z', 'Z', 20)];
    const messages = deriveMessagesFromEvents(events, projections);
    expect(messages.map((m) => m.id)).toEqual(['msg-a', 'msg-b', 'msg-z']);
  });
});
