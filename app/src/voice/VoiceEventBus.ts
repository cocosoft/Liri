/**
 * VoiceEventBus 实现
 * 事件分发与状态管理，支持 Client→Server 和 Server→Client 双向事件
 *
 * 继承自 EventBusImpl，复用标准事件订阅/发布能力；本层仅保留：
 *   1. 语音会话状态管理（setState / onStateChange / currentState）
 *   2. 类型安全的事件通道（voice:client / voice:server / voice:error）
 */
import { EventBusImpl } from '@modules/core/events/EventBus';
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

export class VoiceEventBus extends EventBusImpl implements VoiceEventBusInterface {
  private logger = new Logger({ level: LogLevel.INFO });

  /** 状态变更处理器 —— 与 VoiceSessionState 状态机耦合，保留在领域层 */
  private stateChangeHandlers: Set<VoiceStateChangeHandler> = new Set();

  private _currentState: VoiceSessionState = 'idle';

  get currentState(): VoiceSessionState {
    return this._currentState;
  }

  /** 注册客户端事件处理器（收到来自客户端的 VoiceClientEvent） */
  onClientEvent(handler: VoiceClientEventHandler): void {
    this.subscribe(CHANNEL_CLIENT, handler as any);
  }

  /** 注册服务端事件处理器（收到来自服务端的 VoiceServerEvent） */
  onServerEvent(handler: VoiceServerEventHandler): void {
    this.subscribe(CHANNEL_SERVER, handler as any);
  }

  /** 注册错误事件处理器 */
  onError(handler: VoiceErrorHandler): void {
    this.subscribe(CHANNEL_ERROR, handler as any);
  }

  /** 注册状态变更处理器（领域层状态机） */
  onStateChange(handler: VoiceStateChangeHandler): void {
    this.stateChangeHandlers.add(handler);
  }

  /** 向客户端分发事件（服务端事件 → 客户端处理器） */
  emitToClient(event: VoiceServerEvent): void {
    this.publish(CHANNEL_SERVER, event);
  }

  /** 向服务端分发事件（客户端事件 → 服务端处理器） */
  emitToServer(event: VoiceClientEvent): void {
    this.publish(CHANNEL_CLIENT, event);
  }

  /** 分发错误事件 */
  emitError(error: Error): void {
    this.logger.warn('事件总线 · 错误事件', { message: error.message });
    this.publish(CHANNEL_ERROR, error);
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
    this.unsubscribeAll();
    this.stateChangeHandlers.clear();
    this._currentState = 'idle';
  }
}
