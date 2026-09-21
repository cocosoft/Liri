/**
 * 阶段 A（A1-f）：yield 让出的历史回填测试
 *
 * 锁定：`turn/end { finishReason: 'yielded' }` 的回合，其派生消息带
 * `finishReason='yielded'`（历史回放可识别"已让出、等待子代理结算"）；
 * 普通收尾（stop）不受影响（不补任何 finishReason）。
 */
import { describe, expect, it } from 'bun:test';
import { deriveMessagesFromEvents } from '../../src/session/storage/EventMessageDeriver';
import type { LiriEvent } from '../../src/chat/types/events';

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

describe('A1-f：yield 让出的历史回填', () => {
  it('turn/end finishReason=yielded ⇒ 该轮派生消息带 finishReason=yielded', () => {
    const events: LiriEvent[] = [
      ev(1, 'user/message', {
        content: '并行派发三个任务',
        messageId: 'msg-1',
      }),
      ev(2, 'turn/start', { turn: 1 }),
      ev(3, 'assistant/text', {
        content: '已派发，等待子代理结算',
        messageId: 'msg-2',
      }),
      ev(4, 'assistant/tool_call', {
        toolCallId: 'tc-yield',
        name: 'sessions_yield',
        args: {},
        messageId: 'msg-2',
        callSeq: 4,
      }),
      ev(5, 'turn/end', { turn: 1, finishReason: 'yielded', yielded: true }),
    ];

    const messages = deriveMessagesFromEvents(events, []);
    const asst = messages.find((m) => m.id === 'msg-2');
    expect(asst?.finishReason).toBe('yielded');
  });

  it('普通收尾（stop）⇒ 不补 finishReason（yield 语义不外溢）', () => {
    const events: LiriEvent[] = [
      ev(1, 'user/message', { content: '你好', messageId: 'msg-1' }),
      ev(2, 'turn/start', { turn: 1 }),
      ev(3, 'assistant/text', { content: '你好！', messageId: 'msg-2' }),
      ev(4, 'turn/end', { turn: 1, finishReason: 'stop' }),
    ];

    const messages = deriveMessagesFromEvents(events, []);
    expect(
      messages.find((m) => m.id === 'msg-2')?.finishReason
    ).toBeUndefined();
  });

  it('yield 与中断互不干扰：canceled 仍按既有规则处理', () => {
    const events: LiriEvent[] = [
      ev(1, 'user/message', { content: '任务', messageId: 'msg-1' }),
      ev(2, 'turn/start', { turn: 1 }),
      // 空正文 + canceled ⇒ 仍判定为真中断（既有语义）
      ev(3, 'turn/end', { turn: 1, finishReason: 'canceled' }),
    ];

    const messages = deriveMessagesFromEvents(events, []);
    expect(messages.find((m) => m.id === 'msg-1')).toBeTruthy();
    // 该轮无助手正文消息 ⇒ 不产生带 yield 的派生消息
    expect(messages.some((m) => m.finishReason === 'yielded')).toBe(false);
  });
});
