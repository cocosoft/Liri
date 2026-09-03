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
} from '@modules/chronos';
import { globalEventBus, SystemEvents } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import { recordBackgroundTask } from '@modules/monitoring';
import { handleError } from '@modules/error';
import {
  BackgroundTaskState,
  getBackgroundTaskStateMachine,
} from '../state/background/BackgroundTaskStateMachine';

const logger = getLogger('dream:dreamEngine');

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
    // §十 阶段 C：以状态机表达后台任务运行态（替代手写 this.cycle.isRunning 布尔守卫）
    const sm = getBackgroundTaskStateMachine('dream');
    if (sm.getState() === BackgroundTaskState.RUNNING) {
      logger.info('[DreamEngine] 梦境周期正在进行中，跳过');
      // §9.3 统一后台任务事件：skip（R08-002）
      recordBackgroundTask({
        task: 'dream',
        phase: 'skip',
        startedAt: Date.now(),
        status: 'cycle already running',
        metadata: { triggerSource: source },
      });
      return;
    }
    sm.transition(BackgroundTaskState.RUNNING, 'cycle start');

    const startTime = Date.now();
    // §9.3 统一后台任务事件：start（R08-002）
    recordBackgroundTask({
      task: 'dream',
      phase: 'start',
      startedAt: startTime,
      metadata: { triggerSource: source },
    });
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
        // 保持 RUNNING：状态机由真正在跑的周期负责推进到终态，这里不抢占
        return;
      }

      logger.error(
        `[DreamEngine] 梦境执行失败: ${errMsg}`,
        e instanceof Error ? e : new Error(errMsg)
      );
      void handleError(e, {
        module: 'dream:engine',
        action: 'executeDreamCycle',
      });
    }

    // §十 阶段 C：记录周期终态（completed / failed）
    sm.transition(
      success ? BackgroundTaskState.COMPLETED : BackgroundTaskState.FAILED,
      success ? 'cycle completed' : 'cycle failed'
    );

    // §9.3 统一后台任务事件：complete / fail（R08-002）
    recordBackgroundTask({
      task: 'dream',
      phase: success ? 'complete' : 'fail',
      startedAt: startTime,
      endedAt: Date.now(),
      durationMs: Date.now() - startTime,
      status: success ? 'cycle completed' : 'cycle failed',
      metadata: {
        triggerSource: source,
        sessionsProcessed: record?.sessionsProcessed,
        memoriesCreated: record?.memoriesCreated,
      },
    });

    // 保存兼容 DreamRecord
    // 3-3（2026-09-03）deprecated：周期权威记录为 UnifiedDreamCycle.saveCycle → cycles/<cycleId>.json
    // （dream_records.json 属历史兼容通道，50 条上限；后续版本可移除本双写）
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
