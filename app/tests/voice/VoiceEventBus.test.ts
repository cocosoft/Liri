/**
 * VoiceEventBus 单元测试
 * 覆盖事件注册/注销/分发、状态管理、错误传播
 */

import { describe, it, expect } from 'bun:test';

import { VoiceEventBus } from '../../src/voice/VoiceEventBus.js';
import type { VoiceClientEvent, VoiceServerEvent } from '../../src/voice/types.js';

function createClientEvent(type: string): VoiceClientEvent {
  return { type } as VoiceClientEvent;
}

function createServerEvent(type: string): VoiceServerEvent {
  return { type } as VoiceServerEvent;
}

describe('VoiceEventBus', () => {

  it('初始状态为 idle', () => {
    const bus = new VoiceEventBus();
    expect(bus.currentState).toBe('idle');
  });

  it('分发 Client 事件到注册的处理器', () => {
    const bus = new VoiceEventBus();
    const received: VoiceClientEvent[] = [];

    bus.onClientEvent((event) => received.push(event));
    bus.emitToServer(createClientEvent('audio.append'));

    expect(received.length).toBe(1);
    expect(received[0].type).toBe('audio.append');
  });

  it('分发 Server 事件到注册的处理器', () => {
    const bus = new VoiceEventBus();
    const received: VoiceServerEvent[] = [];

    bus.onServerEvent((event) => received.push(event));
    bus.emitToClient(createServerEvent('audio.delta'));

    expect(received.length).toBe(1);
    expect(received[0].type).toBe('audio.delta');
  });

  it('多个 Client 处理器都收到事件', () => {
    const bus = new VoiceEventBus();
    const received: string[] = [];

    bus.onClientEvent(() => received.push('h1'));
    bus.onClientEvent(() => received.push('h2'));
    bus.emitToServer(createClientEvent('response.create'));

    expect(received).toEqual(['h1', 'h2']);
  });

  it('状态变更通知所有处理器', () => {
    const bus = new VoiceEventBus();
    const states: Array<{ state: string; previous: string }> = [];

    bus.onStateChange((state, previous) => {
      states.push({ state, previous });
    });

    bus.setState('connecting');
    bus.setState('connected');

    expect(states.length).toBe(2);
    expect(states[0]).toEqual({ state: 'connecting', previous: 'idle' });
    expect(states[1]).toEqual({ state: 'connected', previous: 'connecting' });
  });

  it('相同状态不触发重复通知', () => {
    const bus = new VoiceEventBus();
    let count = 0;

    bus.onStateChange(() => count++);
    bus.setState('connecting');
    bus.setState('connecting');

    expect(count).toBe(1);
  });

  it('错误事件分发到所有错误处理器', () => {
    const bus = new VoiceEventBus();
    const errors: Error[] = [];

    bus.onError((err) => errors.push(err));
    bus.emitError(new Error('test error'));

    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe('test error');
  });

  it('Client 处理器中的异常传播到错误处理器', () => {
    const bus = new VoiceEventBus();
    const errors: Error[] = [];

    bus.onClientEvent(() => { throw new Error('handler error'); });
    bus.onError((err) => errors.push(err));
    bus.emitToServer(createClientEvent('audio.append'));

    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe('handler error');
  });

  it('状态变更处理器中的异常传播到错误处理器', () => {
    const bus = new VoiceEventBus();
    const errors: Error[] = [];

    bus.onStateChange(() => { throw new Error('state error'); });
    bus.onError((err) => errors.push(err));
    bus.setState('connected');

    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe('state error');
  });

  it('clear() 移除所有处理器并重置状态', () => {
    const bus = new VoiceEventBus();
    let called = false;

    bus.onClientEvent(() => { called = true; });
    bus.setState('connected');
    bus.clear();

    expect(bus.currentState).toBe('idle');
    bus.emitToServer(createClientEvent('audio.append'));
    expect(called).toBe(false);
  });

  it('错误处理器自身的异常静默忽略（不产生无限循环）', () => {
    const bus = new VoiceEventBus();
    const errors: Error[] = [];

    bus.onError(() => { throw new Error('meta error'); });
    bus.onError((err) => errors.push(err));
    bus.emitError(new Error('original error'));

    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe('original error');
  });
});
