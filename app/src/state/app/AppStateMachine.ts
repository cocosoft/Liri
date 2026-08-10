/**
 * AppStateMachine — 应用全局状态机
 *
 * 管理整个应用的生命周期，提供全局状态的集中管理。
 * 适用场景：应用启动就绪（IDLE）、执行后台任务（BUSY）、
 * 用户暂停应用（PAUSED）、全局错误恢复（ERROR）。
 *
 * 建议通过 StateMachineRegistry 注册为单例，在应用启动时初始化。
 */

import { StateMachine } from '../engine/StateMachine';
import type { StateMachineConfig } from '../engine/types';
import { AppState, APP_TRANSITIONS } from './types';

export { AppState, APP_TRANSITIONS };

export class AppStateMachine extends StateMachine<AppState> {
  /**
   * @param appId 应用标识，作为 contextId 用于日志溯源
   * @param extra 额外引擎配置（§十 阶段 B：onTransition 发布钩子等），与默认配置合并
   */
  constructor(
    appId: string = 'app',
    extra?: Partial<StateMachineConfig<AppState>>
  ) {
    super({
      initialState: AppState.IDLE,
      rules: APP_TRANSITIONS,
      contextId: appId,
      // ERROR/PAUSED 为关键状态：转移进入时日志 ≥ warn（§十 阶段 B）
      criticalStates: [AppState.ERROR, AppState.PAUSED],
      ...extra,
    });
  }

  // ============================================================
  // 便捷方法
  // ============================================================

  /**
   * 标记应用为忙碌：IDLE → BUSY
   */
  setBusy(reason?: string): boolean {
    return this.transition(AppState.BUSY, reason);
  }

  /**
   * 标记应用为空闲：BUSY/PAUSED/ERROR → IDLE
   */
  setIdle(reason?: string): boolean {
    return this.transition(AppState.IDLE, reason);
  }

  /**
   * 暂停应用：IDLE/BUSY/ERROR → PAUSED
   */
  pause(reason?: string): boolean {
    return this.transition(AppState.PAUSED, reason);
  }

  /**
   * 标记全局错误：BUSY → ERROR
   *
   * 将错误信息作为 metadata 传入，保留完整错误上下文。
   */
  setError(err: Error): boolean {
    return this.transition(AppState.ERROR, err.message, {
      stack: err.stack,
      name: err.name,
    });
  }

  // ============================================================
  // 状态查询
  // ============================================================

  /**
   * 是否空闲
   */
  isIdle(): boolean {
    return this.getState() === AppState.IDLE;
  }

  /**
   * 是否忙碌
   */
  isBusy(): boolean {
    return this.getState() === AppState.BUSY;
  }

  /**
   * 是否有全局错误
   */
  hasError(): boolean {
    return this.getState() === AppState.ERROR;
  }
}
