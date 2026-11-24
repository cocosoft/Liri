/**
 * SessionState 生命周期事件桥接适配器
 * 将 SessionLifecycleEventBus 的事件映射到 SessionStateMachine 的状态变化
 */

import type { SessionLifecycleEventBus } from '@modules/session';
import type { SessionLifecycleEvent } from '@modules/session';
import type { EventSubscription } from '@openliri/kernel';
import { SessionStateMachine } from '@openliri/infra/state/session/SessionStateMachine';
// P0（2026-11-24）：生命周期事件驱动的机器实例同样需要 idle → running 归一
import { pauseForApproval } from './sessionMachineGuards';

import { getLogger } from '@openliri/infra/monitoring';
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
        // P0（2026-11-24）：与 finalize 同法 —— 本桥接的机器实例只靠生命周期事件驱动，
        // 未收到 `session:activated` 时仍是 idle；直接 pause 会抛 idle → requires_action。
        pauseForApproval(this.getSessionMachine(event.sessionId), '会话已暂停');
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

    // 2026-11-21：审批卡过期（未执行）⇒ 会话不再是「等待审批」，收口到 idle。
    // 只由普通聊天会话发出；PDCA 步骤卡过期走 `abortPdcaAfterExpiry`，不会到这里。
    this.subscriptions.push(
      this.eventBus.on(
        'session:approval_expired',
        (event: SessionLifecycleEvent) => {
          this.getSessionMachine(event.sessionId).complete(
            event.reason ?? '审批已过期（未执行）'
          );
        }
      )
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
