/**
 * SessionState 生命周期事件桥接适配器
 * 将 SessionLifecycleEventBus 的事件映射到 SessionStateMachine 的状态变化
 */

import type { SessionLifecycleEventBus } from '@modules/session';
import type { SessionLifecycleEvent } from '@modules/session';
import type { EventSubscription } from '@modules/core';
import { SessionStateMachine } from '../../state/session/SessionStateMachine.js';

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
        // 阶段 3（2026-10-12，8 态 → 3 态）：原此处的 try/catch（"忽略非 RUNNING 状态下 complete 失败的
        // 异常"）**已证明不可达**并删除 —— `complete()` 目标为 `idle`，而 3 态转移表中
        // `idle/running/requires_action` **三者到 `idle` 均为合法边或 `from === to` 幂等**
        // （引擎对 `from === to` 早返回；`onTransition` 钩子与 `notifyListeners` 均内置 try/catch）
        // ⇒ `transition()` 只可能抛 `IllegalTransitionError`，而此处不存在该情形（CS03：不保留无用兜底）。
        this.getSessionMachine(event.sessionId).complete('会话归档前完成');
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
