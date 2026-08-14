/**
 * SleepMonitor — Event Loop 滞后休眠检测（2026-08-14 排查补充落地）
 *
 * 背景：Windows 休眠/睡眠期间 Node 定时器整体停摆，唤醒后一次性补跑，
 * 曾观测到 3 次滞后 1~3 小时（滞后时长与相邻日志间隔精确吻合，非死锁）。
 *
 * 机制：定时器 tick 漂移检测。各调度器（CronBridge 1s 轮询、
 * KnowledgeCompileScheduler 5min interval）周期性调用 detectTick(intervalMs)，
 * 相邻 tick 实际间隔减去预期间隔即滞后量；超过阈值判定休眠。
 *
 * 决策：检测到休眠后进入 paused 状态（调度器跳过积压补跑，避免唤醒瞬间
 * 资源尖峰），并通过 globalEventBus 发布 system:sleep_detected 事件；
 * 由用户（前端提示）决策是否继续：resolve(true) 补跑积压任务，
 * resolve(false) 跳过积压任务。
 *
 * 依赖约束：本模块仅发布事件，SSE 广播由订阅者（CronBridge）转发，
 * 避免 core → infrastructure 反向依赖（R06-008）。
 */

import { getLogger } from '../../monitoring/logs/Logger';
import { globalEventBus } from '../events/EventBus';

const logger = getLogger('core:sleepMonitor');

/** 判定休眠的滞后阈值（相邻 tick 实际间隔超过 intervalMs + 该值即视为休眠） */
export const SLEEP_LAG_THRESHOLD_MS = 60_000;

export type TickResult = 'normal' | 'paused' | 'detected';

export interface SleepInfo {
  lagMs: number;
  detectedAt: number;
}

/** 全局事件名（CronBridge / KnowledgeCompileScheduler / 前端订阅） */
export const SLEEP_EVENTS = {
  DETECTED: 'system:sleep_detected',
  RESOLVED: 'system:sleep_resolved',
} as const;

export class SleepMonitor {
  private lastTickTs: number | null = null;
  private paused = false;
  private info: SleepInfo | null = null;

  /**
   * 调度器每 tick 调用一次。
   * - 'detected'：首次检测到休眠（当前调用方负责广播/记录）
   * - 'paused'：已处于暂停状态（当前 tick 需跳过动作）
   * - 'normal'：正常
   */
  detectTick(intervalMs: number): TickResult {
    const now = Date.now();
    let result: TickResult = 'normal';
    if (this.paused) {
      // 暂停期间持续返回 'paused'，确保调度器跳过补跑直到用户决策
      result = 'paused';
    } else if (this.lastTickTs !== null) {
      const lag = now - this.lastTickTs - intervalMs;
      if (lag > SLEEP_LAG_THRESHOLD_MS) {
        this.paused = true;
        this.info = { lagMs: lag, detectedAt: now };
        result = 'detected';
        this.publishDetected();
      }
    }
    this.lastTickTs = now;
    return result;
  }

  /** 是否处于休眠暂停状态（暂停期间跳过积压补跑） */
  isPaused(): boolean {
    return this.paused;
  }

  /** 最近一次休眠检测信息（无则 null） */
  getInfo(): SleepInfo | null {
    return this.info;
  }

  /**
   * 用户决策：
   * - runMissed=true：补跑积压任务（发布 sleep_resolved，调度器恢复触发）
   * - runMissed=false：跳过积压任务（发布 sleep_resolved，调度器跳过过期任务）
   * 未处于暂停状态时调用为空操作。
   */
  resolve(runMissed: boolean): void {
    if (!this.paused) return;
    this.paused = false;
    const info = this.info;
    this.info = null;
    logger.info('sleep:resolved', { runMissed, lagMs: info?.lagMs ?? 0 });
    globalEventBus.publish(SLEEP_EVENTS.RESOLVED, { runMissed });
  }

  private publishDetected(): void {
    const info = this.info;
    if (!info) return;
    logger.warn('sleep:detected', {
      lagMs: info.lagMs,
      lagMinutes: Math.round(info.lagMs / 60000),
    });
    globalEventBus.publish(SLEEP_EVENTS.DETECTED, {
      lagMs: info.lagMs,
      detectedAt: info.detectedAt,
    });
  }
}

/** 全局单例 */
export const sleepMonitor = new SleepMonitor();
