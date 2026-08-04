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
import { UnifiedDreamCycle } from './UnifiedDreamCycle';
import type {
  DreamSchedulerConfig,
  DreamTriggerSource,
  DreamCycleRecord,
} from './types';
import {
  initAutoDream,
  abortAutoDream,
  isAutoDreamRunning,
} from '../chronos/autoDream/AutoDream';
import { globalEventBus, SystemEvents } from '@modules/core';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = new Logger({
  module: 'dream:dreamEngine',
  level: LogLevel.INFO,
});

export class DreamEngine {
  private scheduler: DreamScheduler;
  private phaseManager: DreamPhaseManager;
  private persistence: DreamPersistence;
  private cycle: UnifiedDreamCycle;
  private started = false;

  constructor(config?: Partial<DreamSchedulerConfig>) {
    this.scheduler = new DreamScheduler(config);
    this.phaseManager = new DreamPhaseManager();
    this.persistence = this.scheduler.getPersistence();
    this.cycle = new UnifiedDreamCycle(this.persistence);

    // 注册触发回调
    this.scheduler.setTriggerCallback((source: DreamTriggerSource) =>
      this.executeDreamCycle(source)
    );
  }

  /** 启动梦境引擎 */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // 恢复未完成的检查点
    const { recoverCheckpoints } = await import('./DreamCheckpoint');
    const recovery = await recoverCheckpoints();
    if (recovery.recovered > 0 || recovery.cleaned > 0) {
      logger.info(
        `[DreamEngine] 检查点恢复: ${recovery.recovered} 已恢复, ${recovery.cleaned} 已清理`
      );
    }

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
   * 执行完整梦境周期（五阶段管线）
   * 通过 UnifiedDreamCycle 统一编排 Gather → Analyze → Generate → Write → Index。
   */
  private async executeDreamCycle(source: DreamTriggerSource): Promise<void> {
    if (this.cycle.isRunning) {
      logger.info('[DreamEngine] 梦境周期正在进行中，跳过');
      return;
    }

    const startTime = Date.now();
    let success = false;
    let record: DreamCycleRecord | undefined;

    try {
      record = await this.cycle.execute(source);
      success = record!.status !== 'failed';
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);

      // 409: 并发冲突
      if (errMsg === 'DREAM_CYCLE_BUSY') {
        logger.info('[DreamEngine] 梦境周期已在运行，拒绝触发');
        return;
      }

      logger.error(
        `[DreamEngine] 梦境执行失败: ${errMsg}`,
        e instanceof Error ? e : new Error(errMsg)
      );
      void handleError(e, { module: 'dream:engine', action: 'executeDreamCycle' });
    }

    // 保存兼容 DreamRecord
    const legacyRecord = {
      id: `dream_${startTime}`,
      startedAt: startTime,
      completedAt: Date.now(),
      triggerSource: source,
      phase: 'deep' as const,
      sessionsCount: record?.sessionsProcessed || 0,
      insightsGenerated: record?.memoriesCreated || 0,
      success,
      error: record?.errors?.[0],
    };
    await this.persistence.save(legacyRecord);

    // 发布用户交互事件
    globalEventBus.publish(SystemEvents.USER_INTERACTION, {
      source: 'dream:completed',
      cycleId: record?.cycleId,
      success,
    });
  }
}
