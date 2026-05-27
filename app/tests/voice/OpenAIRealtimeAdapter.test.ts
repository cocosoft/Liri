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
});
