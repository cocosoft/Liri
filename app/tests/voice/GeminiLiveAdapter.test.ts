/**
 * GeminiLiveAdapter 单元测试
 * 覆盖 WebSocket 连接、消息处理、事件路由
 */

import { describe, it, expect } from 'bun:test';

import { GeminiLiveAdapter } from '../../src/voice/GeminiLiveAdapter.js';
import type { VoiceServerEvent } from '../../src/voice/types.js';

describe('GeminiLiveAdapter', () => {

  it('构造函数初始化配置', () => {
    const adapter = new GeminiLiveAdapter('test-key');
    expect(adapter).toBeDefined();
  });

  describe('Token 统计链路（usage.metrics）', () => {
    it('顶层 usageMetadata → 发送 usage.metrics', () => {
      const adapter = new GeminiLiveAdapter('test-key');
      const events: VoiceServerEvent[] = [];
      (
        adapter as unknown as {
          sendToClient: (e: VoiceServerEvent) => void;
        }
      ).sendToClient = (e) => events.push(e);
      const handleMessage = (
        adapter as unknown as { handleMessage(e: { data: string }): void }
      ).handleMessage;

      handleMessage.call(adapter, {
        data: JSON.stringify({
          usageMetadata: {
            promptTokenCount: 25,
            responseTokenCount: 25,
            totalTokenCount: 50,
          },
        }),
      });

      const usageEvent = events.find((e) => e.type === 'usage.metrics');
      expect(usageEvent).toBeDefined();
      if (usageEvent?.type === 'usage.metrics') {
        expect(usageEvent.inputTokens).toBe(25);
        expect(usageEvent.outputTokens).toBe(25);
      }
    });
  });
});
