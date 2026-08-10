/**
 * SessionState 生命周期事件桥接适配器
 * 将 SessionLifecycleEventBus 的事件映射到 SessionStateMachine 的状态变化
 */

import type { SessionLifecycleEventBus } from '@modules/session/lifecycle/SessionLifecycleEventBus';
import type { SessionLifecycleEvent } from '@modules/session/lifecycle/SessionLifecycleEvent';
import type { EventSubscription } from '@modules/core';
import { SessionStateMachine } from '../../state/session/SessionStateMachine.js';
import { handleError } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('chat:services:SessionStateBridge');

export class SessionStateBridge {
  private eventBus: SessionLifecycleEventBus;
  private sessionMachines: Map<string, SessionStateMachine> = new Map();
  private subscriptions: EventSubscription[] = [];
  private connected = false;

  constructor(eventBus: SessionLifecycleEventBus) {
    this.eventBus = eventBus;
  }

  private getSessionMachine(sessionId: string): SessionStateMachine {
    let machine = this.sessionMachines.get(sessionId);
    if (!machine) {
      machine = new SessionStateMachine(sessionId);
      this.sessionMachines.set(sessionId, machine);
    }
    return machine;
  }

  connect(): void {
    if (this.connected) return;

    this.subscriptions.push(
      this.eventBus.on('session:activated', (event: SessionLifecycleEvent) => {
        this.getSessionMachine(event.sessionId).start(
          `会话已激活: ${event.sessionId}`
        );
      })
    );

    this.subscriptions.push(
      this.eventBus.on('session:paused', (event: SessionLifecycleEvent) => {
        this.getSessionMachine(event.sessionId).pause('会话已暂停');
      })
    );

    this.subscriptions.push(
      this.eventBus.on('session:resumed', (event: SessionLifecycleEvent) => {
        this.getSessionMachine(event.sessionId).resume(
          `会话已恢复: ${event.sessionId}`
        );
      })
    );

    this.subscriptions.push(
      this.eventBus.on('session:archived', (event: SessionLifecycleEvent) => {
        const machine = this.getSessionMachine(event.sessionId);
        try {
          machine.complete('会话归档前完成');
        } catch (err) {
          // 忽略非 RUNNING 状态下 complete 失败的异常

          handleError(err, {
            module: 'chat:sessionBridge',
            action: 'completeStateMachine',
          });
        }
      })
    );

    this.subscriptions.push(
      this.eventBus.on('session:error', (event: SessionLifecycleEvent) => {
        this.getSessionMachine(event.sessionId).error(
          new Error(event.reason ?? '会话发生错误')
        );
      })
    );

    this.connected = true;
  }

  disconnect(): void {
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];
    this.sessionMachines.clear();
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
