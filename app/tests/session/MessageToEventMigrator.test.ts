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
import type { Message } from '../../src/chat/types/message';

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
