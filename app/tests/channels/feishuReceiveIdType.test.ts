/**
 * 飞书出站目标类型解析（2026-10-19）。
 *
 * 通道路由传 `conversationId ?? senderId`：`oc_…` 是会话，`ou_…` 是用户。
 * 一律按 `open_id` 发送会导致会话目标发送失败。
 */
import { describe, expect, test } from 'bun:test';
import { resolveFeishuReceiveIdType } from '../../src/channels/feishu/FeishuChannel';

describe('resolveFeishuReceiveIdType', () => {
  test('会话 id（oc_…）⇒ chat_id', () => {
    expect(
      resolveFeishuReceiveIdType('oc_2e67be44147b4be77306f673697b52ed')
    ).toBe('chat_id');
  });

  test('用户 open_id（ou_…）⇒ open_id', () => {
    expect(
      resolveFeishuReceiveIdType('ou_b61d442233f1dfad2d89b7489430e74d')
    ).toBe('open_id');
  });

  test('未知前缀 ⇒ 保守回落 open_id', () => {
    expect(resolveFeishuReceiveIdType('unknown_target')).toBe('open_id');
  });
});
