/**
 * VoiceEventBus 实现
 * 事件分发与状态管理，支持 Client→Server 和 Server→Client 双向事件
 *
 * 事件分发委托给 EventBusImpl，本层仅保留：
 *   1. 语音会话状态管理（setState / onStateChange / currentState）
 *   2. 类型安全的事件通道（voice:client / voice:server / voice:error）
 */
import {
  EventBusImpl,
  EventBus as CoreEventBus,
} from '@modules/core/events/EventBus';
import type { EventSubscription } from '@modules/core/events/EventBus';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import type {
  VoiceClientEvent,
  VoiceServerEvent,
  VoiceEventBus as VoiceEventBusInterface,
  VoiceClientEventHandler,
  VoiceServerEventHandler,
  VoiceErrorHandler,
  VoiceStateChangeHandler,
  VoiceSessionState,
} from './types';

/** 事件通道名常量，用于 EventBusImpl 事件路由 */
const CHANNEL_CLIENT = 'voice:client';
const CHANNEL_SERVER = 'voice:server';
const CHANNEL_ERROR = 'voice:error';

export class VoiceEventBus implements VoiceEventBusInterface, CoreEventBus {
  private logger = new Logger({ level: LogLevel.INFO });

  /** 核心事件总线，处理 client/server/error 三类事件分发 */
  private coreBus = new EventBusImpl();

  /** 状态变更处理器 —— 与 VoiceSessionState 状态机耦合，保留在领域层 */
  private stateChangeHandlers: Set<VoiceStateChangeHandler> = new Set();

  private _currentState: VoiceSessionState = 'idle';

  get currentState(): VoiceSessionState {
    return this._currentState;
  }

  /** 注册客户端事件处理器（收到来自客户端的 VoiceClientEvent） */
  onClientEvent(handler: VoiceClientEventHandler): void {
    this.coreBus.subscribe(CHANNEL_CLIENT, handler as any);
  }

  /** 注册服务端事件处理器（收到来自服务端的 VoiceServerEvent） */
  onServerEvent(handler: VoiceServerEventHandler): void {
    this.coreBus.subscribe(CHANNEL_SERVER, handler as any);
  }

  /** 注册错误事件处理器 */
  onError(handler: VoiceErrorHandler): void {
    this.coreBus.subscribe(CHANNEL_ERROR, handler as any);
  }

  /** 注册状态变更处理器（领域层状态机） */
  onStateChange(handler: VoiceStateChangeHandler): void {
    this.stateChangeHandlers.add(handler);
  }

  /** 向客户端分发事件（服务端事件 → 客户端处理器） */
  emitToClient(event: VoiceServerEvent): void {
    this.coreBus.publish(CHANNEL_SERVER, event);
  }

  /** 向服务端分发事件（客户端事件 → 服务端处理器） */
  emitToServer(event: VoiceClientEvent): void {
    this.coreBus.publish(CHANNEL_CLIENT, event);
  }

  /** 分发错误事件 */
  emitError(error: Error): void {
    this.logger.warn('事件总线 · 错误事件', { message: error.message });
    this.coreBus.publish(CHANNEL_ERROR, error);
  }

  /** 设置会话状态并通知状态变更处理器 */
  setState(state: VoiceSessionState): void {
    const previous = this._currentState;
    if (previous === state) return;
    this.logger.info('事件总线 · 状态变更', { from: previous, to: state });
    this._currentState = state;
    for (const handler of this.stateChangeHandlers) {
      try {
        handler(state, previous);
      } catch (err) {
        this.logger.error('事件总线 · 状态处理器异常', { error: String(err) });
        this.emitError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  /** 清除所有处理器并重置状态 */
  clear(): void {
    this.coreBus.unsubscribeAll();
    this.stateChangeHandlers.clear();
    this._currentState = 'idle';
  }

  // ========== Core EventBus 接口实现 ==========

  /**
   * 订阅事件（标准 EventBus 接口）
   */
  subscribe<T = any>(event: string, listener: (event: T) => void | Promise<void>): EventSubscription {
    return this.coreBus.subscribe(event, listener);
  }

  /**
   * 发布事件（标准 EventBus 接口）
   */
  publish<T = any>(event: string, data?: T): void {
    this.coreBus.publish(event, data);
  }

  /**
   * 订阅一次事件
   */
  once<T = any>(event: string, listener: (event: T) => void | Promise<void>): EventSubscription {
    return this.coreBus.once(event, listener);
  }

  /**
   * 取消订阅
   */
  unsubscribe(event: string, listener: (event: any) => void | Promise<void>): void {
    this.coreBus.unsubscribe(event, listener);
  }

  /**
   * 取消所有订阅
   */
  unsubscribeAll(event?: string): void {
    this.coreBus.unsubscribeAll(event);
  }

  /**
   * 检查是否有监听器
   */
  hasListeners(event: string): boolean {
    return this.coreBus.hasListeners(event);
  }

  /**
   * 获取监听器数量
   */
  listenerCount(event: string): number {
    return this.coreBus.listenerCount(event);
  }
}
