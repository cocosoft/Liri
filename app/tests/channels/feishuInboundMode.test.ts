/**
 * 飞书入站模式选择（2026-10-19）。
 *
 * 前端只提交 appId/appSecret（不含 `useWebSocket`）⇒ 默认必须是长连接；
 * 显式 `false` 才启用 webhook（需公网回调地址）。
 */
import { describe, expect, test } from 'bun:test';
import { resolveFeishuInboundMode } from '../../src/channels/feishu/FeishuChannel';

describe('resolveFeishuInboundMode', () => {
  test('未配置 useWebSocket（前端默认提交面）⇒ websocket', () => {
    expect(resolveFeishuInboundMode({ appId: 'cli_x', appSecret: 's' })).toBe(
      'websocket'
    );
  });

  test('显式 useWebSocket: true ⇒ websocket', () => {
    expect(resolveFeishuInboundMode({ useWebSocket: true })).toBe('websocket');
  });

  test('显式 useWebSocket: false ⇒ webhook（仅公网回调场景）', () => {
    expect(resolveFeishuInboundMode({ useWebSocket: false })).toBe('webhook');
  });
});
