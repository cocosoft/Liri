/**
 * SessionState 生命周期事件桥接适配器
 * 将 SessionLifecycleEventBus 的事件映射到 SessionStateService 的状态变化
 */

import type { SessionLifecycleEventBus } from '@modules/session/lifecycle/SessionLifecycleEventBus';
import type { SessionLifecycleEvent } from '@modules/session/lifecycle/SessionLifecycleEvent';
import type { Subscription } from '@modules/session/lifecycle/SessionLifecycleEventBus';
import { SessionStateService } from './SessionStateService.js';

export class SessionStateBridge {
  private eventBus: SessionLifecycleEventBus;
  private stateService: SessionStateService;
  private subscriptions: Subscription[] = [];
  private connected = false;

  constructor(eventBus: SessionLifecycleEventBus) {
    this.eventBus = eventBus;
    this.stateService = SessionStateService.getInstance();
  }

  connect(): void {
    if (this.connected) return;

    this.subscriptions.push(
      this.eventBus.on('session:activated', (event: SessionLifecycleEvent) => {
        this.stateService.notifySessionStateChanged('running', {
          tool_name: 'session',
          action_description: `会话已激活: ${event.sessionId}`,
          tool_use_id: event.sessionId,
          request_id: event.sessionId,
          input: event.metadata,
        });
      })
    );

    this.subscriptions.push(
      this.eventBus.on('session:paused', () => {
        this.stateService.notifySessionStateChanged('idle');
      })
    );

    this.subscriptions.push(
      this.eventBus.on('session:resumed', (event: SessionLifecycleEvent) => {
        this.stateService.notifySessionStateChanged('running', {
          tool_name: 'session',
          action_description: `会话已恢复: ${event.sessionId}`,
          tool_use_id: event.sessionId,
          request_id: event.sessionId,
          input: event.metadata,
        });
      })
    );

    this.subscriptions.push(
      this.eventBus.on('session:archived', () => {
        this.stateService.notifySessionStateChanged('idle');
      })
    );

    this.subscriptions.push(
      this.eventBus.on('session:error', (event: SessionLifecycleEvent) => {
        this.stateService.notifySessionStateChanged('requires_action', {
          tool_name: 'session_error',
          action_description: event.reason ?? '会话发生错误',
          tool_use_id: event.sessionId,
          request_id: event.sessionId,
          input: event.metadata,
        });
      })
    );

    this.connected = true;
  }

  disconnect(): void {
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
