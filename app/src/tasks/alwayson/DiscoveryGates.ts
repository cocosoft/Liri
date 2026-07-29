/**
 * DiscoveryGates — 9 种门控系统
 *
 * P0-2: 对标 PilotDeck 门控。
 *
 * evaluate(): 完整检查 9 种门控，全部通过才放行。
 * quickRecheck(): 仅检查可能在门控通过后发生变化的关键条件
 *   （agent_busy / recent_user_msg），用于 discovery/execution 入口前二次确认。
 */
import { existsSync } from 'fs';
import type { GateResult, GateReason, AlwaysOnConfig } from './types';
import type { SignalWatcher } from './SignalWatcher';

export class DiscoveryGates {
  private config: AlwaysOnConfig;
  private signalWatcher: SignalWatcher;
  private enabled = true;
  private lastRun = 0;
  private lastUserMsg = 0;
  private todayCount = 0;
  private isDormant = false;
  private isBusy = false;
  private projectPath: string;
  private todayDate = new Date().toDateString();

  constructor(
    config: AlwaysOnConfig,
    signalWatcher: SignalWatcher,
    projectPath: string
  ) {
    this.config = config;
    this.signalWatcher = signalWatcher;
    this.projectPath = projectPath;
  }

  /** 设置外部状态 */
  setEnabled(v: boolean): void {
    this.enabled = v;
  }
  setLastRun(t: number): void {
    this.lastRun = t;
  }
  setLastUserMsg(t: number): void {
    this.lastUserMsg = t;
  }
  recordRun(): void {
    this.lastRun = Date.now();
    // 检查是否跨天，重置日预算计数
    const today = new Date().toDateString();
    if (today !== this.todayDate) {
      this.todayDate = today;
      this.todayCount = 0;
    }
    this.todayCount++;
  }
  setDormant(v: boolean): void {
    this.isDormant = v;
  }
  setBusy(v: boolean): void {
    this.isBusy = v;
  }
  setProjectPath(p: string): void {
    this.projectPath = p;
  }

  /** 完整的 9 门控检查 */
  evaluate(): GateResult {
    // 1. 全局禁用
    if (!this.enabled)
      return this.fail('disabled', 'AlwaysOn is globally disabled');
    // 2. 项目路径不存在
    if (!this.projectPath || !existsSync(this.projectPath))
      return this.fail(
        'project_missing',
        `Project path not found: ${this.projectPath}`
      );
    // 3. 闲置但无文件变更信号
    if (this.isDormant && !this.signalWatcher.hasSignal())
      return this.fail(
        'dormant_no_signal',
        'Project is dormant with no file change signals'
      );
    // 4. Agent 正忙（用户会话进行中）
    if (this.isBusy)
      return this.fail(
        'agent_busy',
        'Agent is currently processing a user session'
      );
    // 5. 最近有用户消息
    if (
      Date.now() - this.lastUserMsg <
      this.config.recentUserMsgMinutes * 60_000
    ) {
      const mins = this.config.recentUserMsgMinutes;
      return this.fail(
        'recent_user_msg',
        `User was active within the last ${mins} minutes`
      );
    }
    // 6. 冷却期
    const cooldownMs = this.config.cooldownMinutes * 60_000;
    if (Date.now() - this.lastRun < cooldownMs) {
      return this.fail(
        'cooldown',
        `Cooldown period active (${this.config.cooldownMinutes} minutes)`
      );
    }
    // 7. 日预算用尽
    if (this.todayCount >= this.config.dailyBudget) {
      return this.fail(
        'daily_budget',
        `Daily budget exhausted (${this.todayCount}/${this.config.dailyBudget})`
      );
    }
    // 8. 全局锁占用（由 ResourceArbiter 管理，不在此处检查）
    return this.pass();
  }

  /**
   * 快速重检：仅检查可能在门控通过后发生变化的关键条件。
   * 用于 discovery()/execution() 入口前二次确认（防止用户突然发消息）
   */
  quickRecheck(): GateResult {
    if (this.isBusy)
      return this.fail(
        'agent_busy',
        'Re-check: agent became busy after gate passed'
      );
    if (
      Date.now() - this.lastUserMsg <
      this.config.recentUserMsgMinutes * 60_000
    ) {
      return this.fail(
        'recent_user_msg',
        'Re-check: user became active after gate passed'
      );
    }
    return this.pass();
  }

  private fail(reason: GateReason, detail: string): GateResult {
    return { passed: false, reason, detail };
  }
  private pass(): GateResult {
    return { passed: true };
  }
}
