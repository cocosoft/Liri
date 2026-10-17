// MIT License
// Copyright (c) 2026 190615273@qq.com
// MessageToEventMigrator.convertMessage 回归测试（2026-08-30）
// 覆盖 D1 无损 JSON 校验相关的 undefined 键修复：
//   1. user 顶层 replyToId → 事件 data 携带 replyToId
//   2. user metadata.replyToId（session-handlers 写前落盘存放位置）→ 事件 data 携带 replyToId
//   3. user 无 replyToId → 事件 data 不含 replyToId 键（undefined 键会触发 invalid-event → pendingRepair）
//   4. tool 无 parentMsgId（v0 数据）→ 事件 data 不含 messageId 键（同 D1 防护）
//   5. tool 有 parentMsgId → 事件 data 携带 messageId + schemaVersion

import { describe, expect, it } from 'bun:test';
import { MessageToEventMigrator } from '../../src/session/storage/MessageToEventMigrator';
import { createMessageService } from '../../src/chat/services/MessageService';
import { MessageStatus } from '@modules/session/types/message/enums';
import type { Message } from '@modules/session/types/message';

// EventLogStorage 实例仅用于满足构造签名，convertMessage 不触达存储层
const stubStorage = {} as unknown as ConstructorParameters<
  typeof MessageToEventMigrator
>[0];

function convert(message: Partial<Message>) {
  const migrator = new MessageToEventMigrator(
    stubStorage,
    'session_test_migrator',
    'default'
  );
  return migrator.convertMessage(
    { id: 'm1', role: 'user', content: 'hi', ...message } as Message,
    1,
    1700000000000
  );
}

describe('MessageToEventMigrator.convertMessage replyToId 修复（D1 undefined 键）', () => {
  it('user 顶层 replyToId → 事件 data 携带 replyToId', () => {
    const { events } = convert({
      role: 'user',
      replyToId: 'parent-123',
    } as unknown as Partial<Message>);
    const userEvent = events.find((e) => e.type === 'user/message');
    expect(userEvent).toBeDefined();
    const data = userEvent!.data as Record<string, unknown>;
    expect(data.replyToId).toBe('parent-123');
  });

  it('user metadata.replyToId（session-handlers 写前落盘位置）→ 事件 data 携带 replyToId', () => {
    const { events } = convert({
      role: 'user',
      metadata: { replyToId: 'parent-456' },
    } as unknown as Partial<Message>);
    const userEvent = events.find((e) => e.type === 'user/message');
    const data = userEvent!.data as Record<string, unknown>;
    expect(data.replyToId).toBe('parent-456');
  });

  it('user 无 replyToId → 事件 data 不含 replyToId 键（防 undefined 键）', () => {
    const { events } = convert({ role: 'user' } as unknown as Partial<Message>);
    const userEvent = events.find((e) => e.type === 'user/message');
    const data = userEvent!.data as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(data, 'replyToId')).toBe(false);
  });

  it('tool 无 parentMsgId（v0 数据）→ 事件 data 不含 messageId 键', () => {
    const { events } = convert({
      role: 'tool',
      toolCallId: 'call_0',
      content: 'result',
    } as unknown as Partial<Message>);
    const toolEvent = events.find((e) => e.type === 'tool/result');
    expect(toolEvent).toBeDefined();
    const data = toolEvent!.data as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(data, 'messageId')).toBe(false);
    expect(toolEvent!.schemaVersion).toBeUndefined();
  });

  it('tool 有 parentMsgId → 事件 data 携带 messageId + schemaVersion', () => {
    const { events } = convert({
      role: 'tool',
      toolCallId: 'call_1',
      content: 'result',
      metadata: { parentMessageId: 'parent-789' },
    } as unknown as Partial<Message>);
    const toolEvent = events.find((e) => e.type === 'tool/result');
    const data = toolEvent!.data as Record<string, unknown>;
    expect(data.messageId).toBe('parent-789');
    expect(toolEvent!.schemaVersion).toBe(1);
  });
});

// T-13-a（2026-10-17）：工具失败状态位落盘 —— 误调用率口径依赖 `tool/result.isError`，
// 在此固定「构造处落位（status/metadata）+ 投影读取」两端行为。
describe('tool/result isError 状态位（T-13-a）', () => {
  const toolEventData = (events: Array<{ type: string; data: unknown }>) => {
    const ev = events.find((e) => e.type === 'tool/result');
    return ev!.data as Record<string, unknown>;
  };

  it('createToolResultMessage(error) → status=FAILED 且 metadata.isError=true', () => {
    const ms = createMessageService();
    const msg = ms.createToolResultMessage({
      toolCallId: 'call_err',
      result: 'partial',
      error: 'boom',
    } as never);
    expect(msg.status).toBe(MessageStatus.FAILED);
    expect((msg.metadata as Record<string, unknown>)?.isError).toBe(true);
  });

  it('createToolResultMessage(成功) → 不落失败位', () => {
    const ms = createMessageService();
    const msg = ms.createToolResultMessage({
      toolCallId: 'call_ok',
      result: 'ok',
    } as never);
    expect(msg.status).not.toBe(MessageStatus.FAILED);
    expect((msg.metadata as Record<string, unknown> | undefined)?.isError).toBeUndefined();
  });

  it('createToolResultMessage(error) 保留调用方 metadata', () => {
    const ms = createMessageService();
    const msg = ms.createToolResultMessage(
      { toolCallId: 'call_err2', result: 'x', error: 'e' } as never,
      { sessionId: 's1', metadata: { parentMessageId: 'p1' } }
    );
    expect((msg.metadata as Record<string, unknown>)?.isError).toBe(true);
    expect((msg.metadata as Record<string, unknown>)?.parentMessageId).toBe('p1');
  });

  it('投影：status=FAILED → isError=true', () => {
    const { events } = convert({
      role: 'tool',
      toolCallId: 'c_failed',
      content: 'x',
      status: MessageStatus.FAILED,
    } as unknown as Partial<Message>);
    expect(toolEventData(events).isError).toBe(true);
  });

  it('投影：metadata.isError=true → isError=true', () => {
    const { events } = convert({
      role: 'tool',
      toolCallId: 'c_meta',
      content: 'x',
      metadata: { isError: true },
    } as unknown as Partial<Message>);
    expect(toolEventData(events).isError).toBe(true);
  });

  it('投影：成功结果 → isError=false', () => {
    const { events } = convert({
      role: 'tool',
      toolCallId: 'c_ok',
      content: 'ok',
    } as unknown as Partial<Message>);
    expect(toolEventData(events).isError).toBe(false);
  });
});
