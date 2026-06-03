// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * DreamEngine — 梦境引擎主入口
 *
 * 独立于守护进程运行，组合调度器 + 阶段管理器 + 持久化。
 * 负责任务调度、阶段编排和状态持久化，实际梦境执行委托给 AutoDream。
 */

import { DreamScheduler } from './DreamScheduler';
import { DreamPhaseManager } from './DreamPhaseManager';
import { DreamPersistence } from './DreamPersistence';
import type { DreamSchedulerConfig, DreamPhase, DreamTriggerSource } from './types';
import { initAutoDream, executeAutoDream, abortAutoDream, isAutoDreamRunning } from '../chronos/autoDream/AutoDream';
import { globalEventBus, SystemEvents } from '@modules/core/events/EventBus';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export class DreamEngine {
  private scheduler: DreamScheduler;
  private phaseManager: DreamPhaseManager;
  private persistence: DreamPersistence;
  private started = false;

  constructor(config?: Partial<DreamSchedulerConfig>) {
    this.scheduler = new DreamScheduler(config);
    this.phaseManager = new DreamPhaseManager();
    this.persistence = this.scheduler.getPersistence();

    // 注册触发回调
    this.scheduler.setTriggerCallback((source: DreamTriggerSource) =>
      this.executeDreamCycle(source)
    );
  }

  /** 启动梦境引擎 */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await initAutoDream();
    await this.scheduler.start();
    logger.info('[DreamEngine] 梦境引擎已启动');
  }

  /** 停止梦境引擎 */
  async stop(): Promise<void> {
    this.started = false;
    this.scheduler.stop();
    await this.abortCurrentDream();
    logger.info('[DreamEngine] 梦境引擎已停止');
  }

  /** 引擎是否运行中 */
  isRunning(): boolean {
    return this.started;
  }

  /** 获取空闲检测器（供外部更新活动时间） */
  getIdleDetector() {
    return this.scheduler.getIdleDetector();
  }

  /** 手动触发梦境 */
  async triggerDream(source: DreamTriggerSource = 'manual'): Promise<void> {
    logger.info(`[DreamEngine] 手动触发梦境（来源: ${source}）`);
    await this.executeDreamCycle(source);
  }

  /** 中断当前梦境 */
  async abortCurrentDream(): Promise<void> {
    if (isAutoDreamRunning()) {
      abortAutoDream();
      logger.info('[DreamEngine] 已中断当前梦境');
    }
  }

  /**
   * 执行完整梦境周期（单阶段执行）
   * 委托给 AutoDream 执行实际整合逻辑，
   * 完成后记录持久化状态并触发知识雨。
   */
  private async executeDreamCycle(source: DreamTriggerSource): Promise<void> {
    if (isAutoDreamRunning()) {
      logger.info('[DreamEngine] 已有梦境正在运行，跳过');
      return;
    }

    const startTime = Date.now();
    let success = false;
    let error: string | undefined;

    try {
      await executeAutoDream();
      success = true;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      logger.error(`[DreamEngine] 梦境执行失败: ${error}`, e instanceof Error ? e : new Error(error));
    }

    const record = {
      id: `dream_${startTime}`,
      startedAt: startTime,
      completedAt: Date.now(),
      triggerSource: source,
      phase: 'deep' as DreamPhase,
      sessionsCount: 0,
      insightsGenerated: 0,
      success,
      error,
    };

    await this.persistence.save(record);

    // 发布用户交互事件，将梦境完成视为一次系统活动
    globalEventBus.publish(SystemEvents.USER_INTERACTION, {
      source: 'dream:completed',
      success,
    });
  }
}
