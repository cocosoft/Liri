import { Logger } from '../monitoring/logs/Logger';
import { getMonitoringService } from '../monitoring/MonitoringService';
import { createSqliteCronStore } from '../chronos/service/SqliteCronStore';
import { nextCronRunMs } from '../chronos/CronTasks';
import { startHealthServer, stopHealthServer } from './HealthServer';
import type { TaskQueue } from './TaskQueue';
import { TaskPriority } from './TaskPriority';
import type { ManagedProcess } from './ProcessManager';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

const logger = new Logger({ level: 'info' as any });

export interface CronBridgeConfig {
  dir?: string;
  lockIdentity?: string;
  taskTimeout?: number;
}

export class CronBridge implements ManagedProcess {
  public readonly name = 'cron-bridge';
  private timerId: ReturnType<typeof setInterval> | null = null;
  private taskQueue: TaskQueue;
  private config: Required<CronBridgeConfig>;
  private running = false;
  private sqliteCronStore: ReturnType<typeof createSqliteCronStore> | null =
    null;

  constructor(taskQueue: TaskQueue, config: CronBridgeConfig = {}) {
    this.taskQueue = taskQueue;
    this.config = {
      dir: config.dir ?? '',
      lockIdentity: config.lockIdentity ?? 'daemon-cron',
      taskTimeout: config.taskTimeout ?? 60000,
    };
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // 初始化 SQLite cron 存储
    try {
      this.sqliteCronStore = createSqliteCronStore();
      await this.sqliteCronStore.init();
      logger.info('SQLite cron store initialized');

      // 恢复启动时遗漏的定时任务
      const missed = await this.sqliteCronStore.recoverMissedJobs();
      if (missed.length > 0) {
        logger.info(`恢复 ${missed.length} 个遗漏的定时任务`);
        for (const task of missed) {
          this.submitCronTask(task.id, task.prompt, task.metadata);
        }
      }
    } catch (error) {
      logger.warning(
        'SQLite cron store init failed, falling back to JSON file',
        { error }
      );
    }

    // 启动轮询定时器（替代旧的 createCronScheduler）
    const CHECK_INTERVAL_MS = 1000;
    this.timerId = setInterval(async () => {
      if (!this.running || !this.sqliteCronStore) return;

      try {
        const tasks = await this.sqliteCronStore!.listTasks();
        const now = Date.now();

        for (const task of tasks) {
          // 计算该任务上次触发后的下次运行时间
          const lastRef = task.lastFiredAt ?? task.createdAt;
          const nextRun = nextCronRunMs(task.cron, lastRef);

          // 若下次运行时间已到且尚未触发，则触发
          if (nextRun !== null && nextRun <= now) {
            this.submitCronTask(task.id, task.prompt, task.metadata);
            await this.sqliteCronStore!.markFired([task.id], now);
          }
        }
      } catch (error) {
        logger.warning('[CronBridge] 轮询检查失败', { error });
      }
    }, CHECK_INTERVAL_MS);

    // O-02: 启动健康检查服务
    startHealthServer().catch((error) => {
      logger.warning('[O-02] 健康检查服务启动异常', { error });
    });

    logger.info('CronBridge 已启动（polling 模式）');
    this.reportMetrics(true);
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    // O-02: 停止健康检查服务
    stopHealthServer();

    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    if (this.sqliteCronStore) {
      await this.sqliteCronStore.close();
      this.sqliteCronStore = null;
    }
    logger.info('CronBridge 已停止');
    this.reportMetrics(false);
  }

  async healthCheck(): Promise<boolean> {
    try {
      if (this.sqliteCronStore) {
        await this.sqliteCronStore.listTasks();
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  private submitCronTask(
    taskId: string,
    prompt: string,
    metadata?: Record<string, unknown>
  ): void {
    if (!this.running) return;

    this.taskQueue.submit({
      id: `cron-${taskId}`,
      name: `定时任务: ${taskId}`,
      priority: TaskPriority.NORMAL,
      timeout: this.config.taskTimeout,
      maxRetries: 1,
      execute: async (signal, onProgress) => {
        onProgress(10);
        logger.info(`执行定时任务: ${taskId}`, { prompt, metadata });
        onProgress(50);

        if (signal.aborted) {
          throw new AppError(
            '定时任务被取消',
            ErrorCategory.EXECUTION,
            ErrorSeverity.HIGH,
            '1000'
          );
        }

        onProgress(100);
        return { executed: true, taskId, prompt };
      },
    });
  }

  private reportMetrics(running: boolean): void {
    try {
      getMonitoringService().addMetric(
        'daemon.cronbridge.running',
        running ? 1 : 0
      );
    } catch (err) {
      // MonitoringService not available, skip metric reporting
    }
  }
}
