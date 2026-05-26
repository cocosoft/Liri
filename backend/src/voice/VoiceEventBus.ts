/**
 * VoiceEventBus 实现
 * 事件分发与状态管理，支持 Client→Server 和 Server→Client 双向事件
 */
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

export class VoiceEventBus implements VoiceEventBusInterface {
  private logger = new Logger({ level: LogLevel.INFO });
  private clientHandlers: Set<VoiceClientEventHandler> = new Set();
  private serverHandlers: Set<VoiceServerEventHandler> = new Set();
  private errorHandlers: Set<VoiceErrorHandler> = new Set();
  private stateChangeHandlers: Set<VoiceStateChangeHandler> = new Set();
  private _currentState: VoiceSessionState = 'idle';

  get currentState(): VoiceSessionState {
    return this._currentState;
  }

  onClientEvent(handler: VoiceClientEventHandler): void {
    this.clientHandlers.add(handler);
  }

  onServerEvent(handler: VoiceServerEventHandler): void {
    this.serverHandlers.add(handler);
  }

  onError(handler: VoiceErrorHandler): void {
    this.errorHandlers.add(handler);
  }

  onStateChange(handler: VoiceStateChangeHandler): void {
    this.stateChangeHandlers.add(handler);
  }

  emitToClient(event: VoiceServerEvent): void {
    for (const handler of this.serverHandlers) {
      try {
        handler(event);
      } catch (err) {
        this.logger.error('事件总线 · 服务端处理器异常', {
          error: String(err),
        });
        this.emitError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  emitToServer(event: VoiceClientEvent): void {
    for (const handler of this.clientHandlers) {
      try {
        handler(event);
      } catch (err) {
        this.logger.error('事件总线 · 客户端处理器异常', {
          error: String(err),
        });
        this.emitError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  emitError(error: Error): void {
    this.logger.warn('事件总线 · 错误事件', { message: error.message });
    for (const handler of this.errorHandlers) {
      try {
        handler(error);
      } catch {
        this.logger.error('事件总线 · 错误处理器自身失败', {
          error: String(error),
        });
      }
    }
  }

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

  clear(): void {
    this.clientHandlers.clear();
    this.serverHandlers.clear();
    this.errorHandlers.clear();
    this.stateChangeHandlers.clear();
    this._currentState = 'idle';
  }
}
