// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * shutdown — 宿主清理（issue #19 · Cut G，2026-10-29）
 *
 * 迁出来源：`ChatManager.cleanup()`（原 1581–1628，48 行）。
 *
 * 逐条保持迁移前的**顺序与纪律**（顺序即语义，勿重排）：
 * 1. 卸载 yield 恢复器 + 清空两条续跑执行器与 run 探针；
 * 2. 卸载预算放行监听（**仅当本实例是装配者**，否则会摘掉 live 实例的 handler）；
 * 3. 清空模块级单例 `YieldRegistry` 的等待集（否则新实例会对陈旧登记发起恢复）；
 * 4. 注销本实例登记进进程级注册表的全部 TAORLoop（否则实例重建累积僵尸端口）；
 * 5. 中止/杀死全部任务 + 关闭任务注册表；重置流服务。
 */

import { getLogger } from '@modules/monitoring';
import { taskOrchestrator, taskRegistry } from '@modules/tasks';
import { setSelfWakeResumeHandler } from '@modules/tasks';
import {
  getYieldRegistry,
  setActiveSubagentRunProbe,
} from '../../session/yield';
import { setYieldResumeHandler } from '../yield';
import { getBudgetSuspendCoordinator } from '../../query/budgetSuspend';

const logger = getLogger('chat:manager');

/** 宿主侧实例状态（由调用方读写；本函数不持有任何状态） */
export interface ShutdownHost {
  /** yield 恢复器卸载句柄（未装配 ⇒ null） */
  yieldResumerUninstall: (() => void) | null;
  /** 本实例是否为预算放行监听的**装配者**（非装配者不得摘除 handler） */
  budgetSuspendResumeWired: boolean;
  /** 预算放行监听卸载句柄 */
  budgetReliefUninstall: (() => void) | null;
  /** 清空 yield 恢复器字段（`uninstall = null` + `installed = false`） */
  clearYieldResumer: () => void;
  /** 清空预算放行监听字段（`uninstall = null` + `wired = false`） */
  clearBudgetRelief: () => void;
  /** 注销本实例登记进进程级注册表的全部 TAORLoop */
  unregisterAllTaorLoops: () => void;
  /** 重置流服务（`StreamService.reset()`） */
  resetStreamService: () => void;
}

export function cleanupHost(host: ShutdownHost): void {
  // 1) B1/O1-1：卸载 yield 恢复器 + 清空两条续跑执行器与 run 探针。
  // 未卸载时实例重建会把 listener 累积在模块级数组里，且旧 listener 的闭包
  // 仍指向旧实例（结算信号唤醒的是旧实例）。
  host.yieldResumerUninstall?.();
  host.clearYieldResumer();
  setYieldResumeHandler(null);
  setSelfWakeResumeHandler(null);
  setActiveSubagentRunProbe(null);

  // 2) Task 7：卸载预算放行监听 + 摘除协调器 handler（同 yield 恢复器的防闭包累积纪律）。
  // 仅当**本实例**确是装配者时才摘除 —— 惰性装配后未装配的实例（如丢弃实例）
  // 不得清掉 live 实例已装配的 handler。
  if (host.budgetSuspendResumeWired) {
    host.budgetReliefUninstall?.();
    host.clearBudgetRelief();
    getBudgetSuspendCoordinator().setResumeHandler(null);
  }

  // 3) B1-6 / P0-6：**清空模块级单例的等待集**。卸载 listener 只切断"新信号"，
  // 而 `YieldRegistry` 是**进程级单例** ⇒ 条目会跨实例残留。
  getYieldRegistry().clear();

  // 4) I1：注销本实例登记进进程级注册表的全部 TAORLoop（否则 `activeLoops` 累积僵尸端口）。
  host.unregisterAllTaorLoops();

  // 5) 任务收口：逐条容错（清理链任何失败都不得上抛）
  taskOrchestrator
    .abortAll()
    .catch((e) => logger.warn('cleanup: abortAll 失败', { error: String(e) }));
  for (const task of taskRegistry.getRunningTasks()) {
    task.kill().catch((e) =>
      logger.warn('cleanup: kill task 失败', {
        taskId: task.id,
        error: String(e),
      })
    );
  }
  taskRegistry
    .shutdown()
    .catch((e) => logger.warn('cleanup: shutdown 失败', { error: String(e) }));
  host.resetStreamService();
}
