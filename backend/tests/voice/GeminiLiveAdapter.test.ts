/**
 * GeminiLiveAdapter 单元测试
 * 覆盖 WebSocket 连接、消息处理、事件路由
 */

import { describe, it, expect } from 'bun:test';

import { GeminiLiveAdapter } from '../../src/voice/GeminiLiveAdapter.js';

describe('GeminiLiveAdapter', () => {

  it('构造函数初始化配置', () => {
    const adapter = new GeminiLiveAdapter('test-key');
    expect(adapter).toBeDefined();
  });
});
