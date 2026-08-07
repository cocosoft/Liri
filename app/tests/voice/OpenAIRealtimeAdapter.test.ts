/**
 * OpenAIRealtimeAdapter 单元测试
 * 覆盖 WebSocket 连接、消息处理、事件路由、重连逻辑
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

import { OpenAIRealtimeAdapter } from '../../src/voice/OpenAIRealtimeAdapter.js';
import type { VoiceSessionConfigEvent, VoiceServerEvent } from '../../src/voice/types.js';

describe('OpenAIRealtimeAdapter', () => {

  it('构造函数初始化配置', () => {
    const adapter = new OpenAIRealtimeAdapter('test-key');
    expect(adapter).toBeDefined();
  });

  it('使用自定义 model 和 voice', () => {
    const adapter = new OpenAIRealtimeAdapter('test-key', 'gpt-4o', 'echo');
    expect(adapter).toBeDefined();
  });

  describe('Token 统计链路（usage.metrics）', () => {
    function makeAdapter(events: VoiceServerEvent[]): OpenAIRealtimeAdapter {
      const adapter = new OpenAIRealtimeAdapter('test-key');
      (
        adapter as unknown as {
          sendToClient: (e: VoiceServerEvent) => void;
        }
      ).sendToClient = (e) => events.push(e);
      return adapter;
    }

    it('response.done 携带 usage → 发送 usage.metrics', () => {
      const events: VoiceServerEvent[] = [];
      const adapter = makeAdapter(events);
      const dispatch = (
        adapter as unknown as { dispatchOpenAIEvent(raw: string): void }
      ).dispatchOpenAIEvent;

      dispatch.call(
        adapter,
        JSON.stringify({
          type: 'response.done',
          response: {
            id: 'resp_1',
            status: 'completed',
            usage: { total_tokens: 100, input_tokens: 40, output_tokens: 60 },
          },
        })
      );

      const usageEvent = events.find((e) => e.type === 'usage.metrics');
      expect(usageEvent).toBeDefined();
      if (usageEvent?.type === 'usage.metrics') {
        expect(usageEvent.inputTokens).toBe(40);
        expect(usageEvent.outputTokens).toBe(60);
      }
    });

    it('response.done 无 usage 字段 → 不发 usage.metrics', () => {
      const events: VoiceServerEvent[] = [];
      const adapter = makeAdapter(events);
      const dispatch = (
        adapter as unknown as { dispatchOpenAIEvent(raw: string): void }
      ).dispatchOpenAIEvent;

      dispatch.call(
        adapter,
        JSON.stringify({ type: 'response.done', response: { id: 'resp_1' } })
      );

      expect(events.some((e) => e.type === 'usage.metrics')).toBe(false);
    });
  });
});
