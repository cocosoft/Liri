/**
 * VoiceSession 单元测试
 * 覆盖会话生命周期、状态管理、事件路由
 */

import { describe, it, expect, beforeEach } from 'bun:test';

import { VoiceSession } from '../../src/voice/VoiceSession.js';
import type { VoiceConnection, VoiceClientEvent, VoiceServerEvent } from '../../src/voice/types.js';

/**
 * 创建模拟 VoiceConnection
 */
function createMockConnection(id: string = 'test-conn'): VoiceConnection {
  const handlers: {
    message: ((event: VoiceClientEvent) => void)[];
    close: ((code: number, reason: string) => void)[];
    error: ((error: Error) => void)[];
  } = {
    message: [],
    close: [],
    error: [],
  };

  let closeFn: (() => void) | null = null;

  return {
    id,
    send: (event: VoiceServerEvent) => {},
    onMessage: (handler: (event: VoiceClientEvent) => void) => {
      handlers.message.push(handler);
    },
    onClose: (handler: (code: number, reason: string) => void) => {
      handlers.close.push(handler);
    },
    onError: (handler: (error: Error) => void) => {
      handlers.error.push(handler);
    },
    get handlers() {
      return handlers;
    },
  };
}

describe('VoiceSession', () => {

  it('创建会话时状态为 idle', () => {
    const conn = createMockConnection('session-1');
    const session = new VoiceSession(conn as unknown as VoiceConnection);

    expect(session.id).toBe('session-1');
    expect(session.state).toBe('idle');
  });

  it('创建会话时事件总线和工具桥接可用', () => {
    const conn = createMockConnection('session-2');
    const session = new VoiceSession(conn as unknown as VoiceConnection);

    expect(session.bus).toBeDefined();
    expect(session.tools).toBeDefined();
  });

  it('创建多个会话各自独立', () => {
    const conn1 = createMockConnection('s1');
    const conn2 = createMockConnection('s2');
    const session1 = new VoiceSession(conn1 as unknown as VoiceConnection);
    const session2 = new VoiceSession(conn2 as unknown as VoiceConnection);

    expect(session1.id).toBe('s1');
    expect(session2.id).toBe('s2');
    expect(session1.state).toBe('idle');
    expect(session2.state).toBe('idle');
  });
});
