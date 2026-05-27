import { Logger } from '../monitoring/logs/Logger';
import { getMonitoringService } from '../monitoring/MonitoringService';
import { createCronScheduler } from '../chronos/CronScheduler';
import { listAllCronTasks, setCronSqliteStore } from '../chronos/CronTasks';
import { createSqliteCronStore } from '../chronos/service/SqliteCronStore';
import type { ScheduledTask as ChronosTask } from '../chronos/types';
import type { TaskQueue } from './TaskQueue';
import { TaskPriority } from './TaskPriority';
import type { ManagedProcess } from './ProcessManager';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const logger = new Logger({ level: 'info' as any });

export interface CronBridgeConfig {
  dir?: string;
  lockIdentity?: string;
  taskTimeout?: number;
}

export class CronBridge implements ManagedProcess {
  public readonly name = 'cron-bridge';
  private scheduler: ReturnType<typeof createCronScheduler> | null = null;
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

    // 初始化 SQLite cron 存储（替代 JSON 文件持久化）
    try {
      this.sqliteCronStore = createSqliteCronStore();
      await this.sqliteCronStore.init();
      setCronSqliteStore(this.sqliteCronStore);
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

    this.scheduler = createCronScheduler({
      onFire: (prompt: string) => {
        this.submitCronTask('cron-prompt-' + Date.now(), prompt);
      },
      onFireTask: (task: ChronosTask) => {
        this.submitCronTask(task.id, task.prompt, task.metadata);
      },
      onMissed: (tasks: ChronosTask[]) => {
        for (const task of tasks) {
          logger.warning(`错过定时任务: ${task.id}`, { cron: task.cron });
          this.submitCronTask(task.id, task.prompt, task.metadata);
        }
      },
      isLoading: () => false,
      assistantMode: false,
      dir: this.config.dir || undefined,
      lockIdentity: this.config.lockIdentity,
    });

    this.scheduler.start();
    logger.info('CronBridge 已启动，Chronos 定时任务调度已集成');
    this.reportMetrics(true);
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    if (this.scheduler) {
      this.scheduler.stop();
      this.scheduler = null;
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
      await listAllCronTasks(this.config.dir || undefined);
      return true;
    } catch {
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
    } catch {
      // MonitoringService not available, skip metric reporting
    }
  }
}
