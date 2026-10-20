/**
 * 归档定时任务调度
 * 将 DataArchivalStrategy 集成到调度系统中
 * 支持两种方式：
 * 1. setupArchivalScheduler - 基于 setInterval + CronParser 的内存调度（推荐）
 * 2. registerArchivalCronTask - 基于 CronTasks.addCronTask 的文件级持久化调度
 */

import { DataArchivalStrategy } from './DataArchivalStrategy.js';
import type {
  ArchivalConfig,
  ArchiveResult,
  CleanupResult,
} from './DataArchivalStrategy.js';
// 2026-10-01 D-161（`R00-001` 倒挂收口）：改直连 `utils/cron`（infra）——
// 原由 `@modules/tasks`（app）取 `computeNextCronRunMs` 构成 monitoring(infra) -> tasks(app) 倒挂
import { computeNextCronRunMs } from '@modules/utils/cron';
import { getLogger } from '../logs/Logger.js';
import { handleError } from '@modules/error';
import { SCHEDULER_CHECK_INTERVAL_MS } from '@modules/types/schedulerLifecycle';
import { IncidentManager } from '../incidents/IncidentManager.js';

const logger = getLogger('monitoring:archival_cron');

/**
 * 惰性取 chronos（2026-10-20，静态导入图瘦身 P2）
 *
 * 之前这里是**静态** `import { addCronTask … } from '@modules/chronos'`，而入口文件
 * `main.ts` → `monitoring` 是启动期静态链 ⇒ **整个 `chronos` 目录（26 文件 / 157 KB）
 * 被拉进启动图**（实测 eager 图里 `chronos` 唯一的上游就是本文件）。
 *
 * 而 chronos 只在"文件级持久化调度"这两个入口（`registerArchivalCronTask` /
 * `unregisterArchivalCronTask`）才需要；推荐的 `setupArchivalScheduler`（纯内存调度）
 * 完全不用它 ⇒ 改成**动态 import**，让 chronos 回到"首次使用才加载"。
 * 详见 `dev_docs/20261020/静态导入图瘦身-方案.md` P2 切点 #1。
 */
async function loadChronos(): Promise<typeof import('@modules/chronos')> {
  return import('@modules/chronos');
}

/** 默认归档 cron 表达式：每日凌晨 3 点 */
export const DEFAULT_ARCHIVAL_CRON = '0 3 * * *';

/** 归档调度任务 ID */
export const ARCHIVAL_TASK_ID = 'archival-maintenance';

/** 系统归档任务的 prompt 标记 */
const SYSTEM_ARCHIVAL_PROMPT = '__SYSTEM_ARCHIVAL_MAINTENANCE__';

/** 归档维护执行结果 */
export interface ArchivalMaintenanceResult {
  success: boolean;
  archives: ArchiveResult[];
  compressions: ArchiveResult[];
  cleanups: CleanupResult[];
  error?: string;
}

/** 归档调度器配置 */
export interface ArchivalSchedulerConfig {
  cron?: string;
  archivalConfig?: Partial<ArchivalConfig>;
  incidentManager?: IncidentManager;
  onTaskComplete?: (result: ArchivalMaintenanceResult) => void;
}

/** 轻量级调度器句柄 */
export interface ArchivalSchedulerHandle {
  stop(): void;
  removeTask(id: string): void;
  getTasks(): Array<{ id: string; cron: string }>;
  executeTaskManually(taskId: string): Promise<boolean>;
}

/** 调度检查间隔（单一事实源见 `types/schedulerLifecycle`，U-20/B5-2-74） */

/**
 * 执行归档维护
 * 创建 DataArchivalStrategy 实例并执行完整的维护周期（归档→压缩→清理）
 */
export async function executeArchivalMaintenance(
  config?: Partial<ArchivalConfig>,
  incidentManager?: IncidentManager
): Promise<ArchivalMaintenanceResult> {
  try {
    const strategy = new DataArchivalStrategy(config);
    const result = await strategy.runMaintenanceCycle(incidentManager);

    logger.info('归档维护执行成功', {
      archivesCount: result.archives.filter((a) => a.success).length,
      compressionsCount: result.compressions.length,
      cleanupsCount: result.cleanups.reduce((s, c) => s + c.deletedCount, 0),
    });

    return {
      success: true,
      ...result,
    };
  } catch (error) {
    await handleError(error, {
      module: 'monitoring:archival',
      action: 'archival_maintenance',
    });
    return {
      success: false,
      archives: [],
      compressions: [],
      cleanups: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 设置归档调度器（基于 setInterval + CronParser 的内存调度）
 * 返回调度器句柄，调用方负责管理生命周期
 */
export function setupArchivalScheduler(
  options?: ArchivalSchedulerConfig
): ArchivalSchedulerHandle {
  const cron = options?.cron ?? DEFAULT_ARCHIVAL_CRON;
  let nextRunMs: number | null = computeNextCronRunMs(cron, Date.now()) ?? null;
  let timerId: ReturnType<typeof setInterval> | null = setInterval(async () => {
    if (nextRunMs === null) {
      nextRunMs = computeNextCronRunMs(cron, Date.now()) ?? null;
      return;
    }

    const now = Date.now();
    if (now >= nextRunMs) {
      const result = await executeArchivalMaintenance(
        options?.archivalConfig,
        options?.incidentManager
      );

      options?.onTaskComplete?.(result);

      nextRunMs = computeNextCronRunMs(cron, now) ?? null;
    }
  }, SCHEDULER_CHECK_INTERVAL_MS);

  logger.info('归档调度器已启动', { cron });

  const taskEntry = { id: ARCHIVAL_TASK_ID, cron };

  return {
    stop(): void {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
      nextRunMs = null;
    },
    removeTask(_id: string): void {
      // 定时器调度器只有一个内置任务，stop 即可停止所有
      this.stop();
    },
    getTasks(): Array<{ id: string; cron: string }> {
      if (timerId === null) {
        return [];
      }
      return [taskEntry];
    },
    async executeTaskManually(taskId: string): Promise<boolean> {
      if (taskId !== ARCHIVAL_TASK_ID) {
        return false;
      }
      const result = await executeArchivalMaintenance(
        options?.archivalConfig,
        options?.incidentManager
      );
      options?.onTaskComplete?.(result);
      return result.success;
    },
  };
}

/**
 * 停止归档调度器
 */
export function stopArchivalScheduler(
  scheduler: ArchivalSchedulerHandle
): void {
  scheduler.stop();
  logger.info('归档调度器已停止');
}

/**
 * 注册归档定时任务（基于 CronTasks 文件级持久化）
 * 用于需要持久化记录的场景，任务触发需由 CronScheduler 处理
 */
export async function registerArchivalCronTask(
  cron?: string,
  dir?: string
): Promise<string> {
  const expression = cron ?? DEFAULT_ARCHIVAL_CRON;
  const { addCronTask, updateCronTask } = await loadChronos();

  const taskId = await addCronTask(
    expression,
    SYSTEM_ARCHIVAL_PROMPT,
    true,
    true,
    undefined,
    dir
  );

  await updateCronTask(
    taskId,
    {
      taskType: '_system',
      metadata: { type: 'archival', cron: expression },
    },
    dir
  );

  logger.info('归档定时任务已注册', { taskId, cron: expression });

  return taskId;
}

/**
 * 注销归档定时任务（文件级）
 */
export async function unregisterArchivalCronTask(
  taskId?: string,
  dir?: string
): Promise<void> {
  const id = taskId || ARCHIVAL_TASK_ID;
  const { removeCronTasks } = await loadChronos();
  await removeCronTasks([id], dir);
  logger.info('归档定时任务已注销', { taskId: id });
}
