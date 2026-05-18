/**
 * VoiceEventBus 实现
 * 事件分发与状态管理，支持 Client→Server 和 Server→Client 双向事件
 */
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
        this.emitError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  emitToServer(event: VoiceClientEvent): void {
    for (const handler of this.clientHandlers) {
      try {
        handler(event);
      } catch (err) {
        this.emitError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  emitError(error: Error): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(error);
      } catch {
        // 错误处理器自身失败时静默忽略，防止死循环
      }
    }
  }

  setState(state: VoiceSessionState): void {
    const previous = this._currentState;
    if (previous === state) return;
    this._currentState = state;
    for (const handler of this.stateChangeHandlers) {
      try {
        handler(state, previous);
      } catch (err) {
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
