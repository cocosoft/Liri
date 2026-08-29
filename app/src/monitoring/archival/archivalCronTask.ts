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
import { computeNextCronRunMs } from '@modules/tasks';
import { addCronTask, removeCronTasks, updateCronTask } from '@modules/chronos';
import { getLogger } from '../logs/Logger.js';
import { handleError } from '@modules/error';
import { IncidentManager } from '../incidents/IncidentManager.js';

const logger = getLogger('monitoring:archival_cron');

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

/** 调度检查间隔 */
const CHECK_INTERVAL_MS = 60_000;

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
  }, CHECK_INTERVAL_MS);

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
  await removeCronTasks([id], dir);
  logger.info('归档定时任务已注销', { taskId: id });
}
