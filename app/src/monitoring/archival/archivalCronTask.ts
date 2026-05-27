/**
 * 归档定时任务调度
 * 将 DataArchivalStrategy 集成到 Chronos 调度系统中
 * 支持两种调度方式：
 * 1. setupArchivalScheduler - 基于 EnhancedTaskScheduler 的内存调度（推荐）
 * 2. registerArchivalCronTask - 基于 CronTasks.addCronTask 的文件级持久化调度
 */

import { DataArchivalStrategy } from './DataArchivalStrategy.js';
import type {
  ArchivalConfig,
  ArchiveResult,
  CleanupResult,
} from './DataArchivalStrategy.js';
import { EnhancedTaskScheduler } from '../../chronos/EnhancedTaskScheduler.js';
import type { EnhancedSchedulerOptions } from '../../chronos/EnhancedTaskScheduler.js';
import { createEnhancedCronTask } from '../../chronos/EnhancedCronTask.js';
import {
  addCronTask,
  removeCronTasks,
  updateCronTask,
} from '../../chronos/CronTasks.js';
import { Logger, LogLevel } from '../logs/Logger.js';
import { IncidentManager } from '../incidents/IncidentManager.js';

const logger = new Logger({ level: LogLevel.INFO });

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
  onTaskStatusChange?: EnhancedSchedulerOptions['onTaskStatusChange'];
  onTaskComplete?: EnhancedSchedulerOptions['onTaskComplete'];
}

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
    const message = error instanceof Error ? error.message : String(error);
    logger.error(
      '归档维护执行失败',
      error instanceof Error ? error : new Error(message)
    );

    return {
      success: false,
      archives: [],
      compressions: [],
      cleanups: [],
      error: message,
    };
  }
}

/**
 * 设置归档调度器（基于 EnhancedTaskScheduler 的内存调度）
 * 返回调度器实例，调用方负责管理生命周期
 */
export function setupArchivalScheduler(
  options?: ArchivalSchedulerConfig
): EnhancedTaskScheduler {
  const cron = options?.cron ?? DEFAULT_ARCHIVAL_CRON;

  const scheduler = new EnhancedTaskScheduler({
    onTaskExecute: async (task) => {
      if (task.id !== ARCHIVAL_TASK_ID) {
        return { success: false, error: `未知任务: ${task.id}` };
      }

      const result = await executeArchivalMaintenance(
        options?.archivalConfig,
        options?.incidentManager
      );

      const stdout = result.success
        ? `归档 ${result.archives.filter((a) => a.success).length} 项, 压缩 ${result.compressions.length} 项, 清理 ${result.cleanups.reduce((s, c) => s + c.deletedCount, 0)} 项`
        : undefined;

      return {
        success: result.success,
        stdout,
        stderr: result.error,
        error: result.error,
      };
    },
    onTaskStatusChange: options?.onTaskStatusChange,
    onTaskComplete: options?.onTaskComplete,
  });

  const task = createEnhancedCronTask(cron, SYSTEM_ARCHIVAL_PROMPT, true, {
    durable: false,
    maxHistory: 10,
  });

  const archivalTask = { ...task, id: ARCHIVAL_TASK_ID };
  scheduler.addTask(archivalTask);
  scheduler.start();

  logger.info('归档调度器已启动', { cron });

  return scheduler;
}

/**
 * 停止归档调度器
 */
export function stopArchivalScheduler(scheduler: EnhancedTaskScheduler): void {
  scheduler.stop();
  scheduler.removeTask(ARCHIVAL_TASK_ID);
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
