import { getLogger } from '@modules/monitoring';
import { getMonitoringService } from '@modules/monitoring';
import type { HealthStatus as HealthStatusValue } from '@modules/core/health/types.js';
import type { IPCService } from './IPCService';
import { taskRegistry } from '@modules/tasks/TaskRegistry';
import { BaseTask } from '@modules/tasks/BaseTask';
import { TaskType, TaskStatus } from '@modules/tasks/types';
import { globalEventBus, SystemEvents } from '@modules/core';

const logger = getLogger('daemon:processManager');

export interface ProcessConfig {
  maxRestartsPerMinute: number;
  gracefulShutdownTimeout: number;
  healthCheckInterval: number;
}

export interface ManagedProcess {
  name: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  healthCheck: () => Promise<boolean>;
}

export interface ComponentHealth {
  name: string;
  status: HealthStatusValue;
  lastCheck: number;
  message?: string;
}

export interface HealthStatus {
  alive: boolean;
  uptime: number;
  queueDepth: number;
  lastError: string | null;
  componentStatus: ComponentHealth[];
  processCount: number;
  runningCount: number;
  stoppedCount: number;
}

interface ProcessState {
  process: ManagedProcess;
  status: 'stopped' | 'running' | 'stopping';
  restartCount: number;
  lastRestartTimestamps: number[];
  healthCheckTimer?: ReturnType<typeof setInterval>;
}

const DEFAULT_CONFIG: ProcessConfig = {
  maxRestartsPerMinute: 5,
  gracefulShutdownTimeout: 30000,
  healthCheckInterval: 15000,
};

/**
 * 轻量级进程任务包装，用于将进程生命周期注册到 TaskRegistry
 */
class ProcessRegistryTask extends BaseTask {
  readonly type = TaskType.DAEMON_PROCESS;

  constructor(id: string, description: string) {
    super(id, description, '', TaskType.DAEMON_PROCESS);
  }

  async spawn(): Promise<void> {
    /* no-op */
  }
  async kill(): Promise<void> {
    /* no-op */
  }
}

/** process name → registryTaskId 映射 */
const processTaskMap: Map<string, string> = new Map();

export class ProcessManager {
  private processes: Map<string, ProcessState>;
  private config: ProcessConfig;
  private startTime: number;
  private lastError: string | null;

  constructor(config: Partial<ProcessConfig> = {}) {
    this.processes = new Map();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startTime = Date.now();
    this.lastError = null;
  }

  getHealth(queueDepth: number = 0): HealthStatus {
    const now = Date.now();
    const componentStatus: ComponentHealth[] = [];
    let overallAlive = true;

    for (const [name, state] of this.processes) {
      const comp: ComponentHealth = {
        name,
        status: 'healthy',
        lastCheck: now,
      };

      if (state.status === 'running') {
        comp.status = 'healthy';
      } else if (state.status === 'stopping') {
        comp.status = 'degraded';
        overallAlive = false;
        comp.message = '进程正在停止';
      } else {
        comp.status = 'unhealthy';
        overallAlive = false;
        comp.message = `进程状态: ${state.status}`;
      }

      componentStatus.push(comp);
    }

    const running = Array.from(this.processes.values()).filter(
      (s) => s.status === 'running'
    ).length;
    const stopped = Array.from(this.processes.values()).filter(
      (s) => s.status === 'stopped'
    ).length;

    return {
      alive: overallAlive && this.processes.size > 0,
      uptime: now - this.startTime,
      queueDepth,
      lastError: this.lastError,
      componentStatus,
      processCount: this.processes.size,
      runningCount: running,
      stoppedCount: stopped,
    };
  }

  register(process: ManagedProcess): void {
    if (this.processes.has(process.name)) {
      logger.warning(`进程已注册，跳过: ${process.name}`);
      return;
    }
    this.processes.set(process.name, {
      process,
      status: 'stopped',
      restartCount: 0,
      lastRestartTimestamps: [],
    });
    logger.info(`进程已注册: ${process.name}`);

    const registryTaskId = taskRegistry.register(
      new ProcessRegistryTask(process.name, `守护进程: ${process.name}`)
    );
    processTaskMap.set(process.name, registryTaskId);
    globalEventBus.publish(SystemEvents.TASK_CREATED, {
      taskId: registryTaskId,
      name: process.name,
      type: 'daemon_process',
    });

    this.reportProcessCount();
  }

  async start(name: string): Promise<void> {
    const state = this.processes.get(name);
    if (!state) {
      logger.error(`进程未注册: ${name}`);
      return;
    }
    if (state.status === 'running') {
      logger.warning(`进程已在运行: ${name}`);
      return;
    }

    if (!this.canRestart(state)) {
      logger.error(`进程重启次数超限: ${name}`);
      return;
    }

    try {
      state.status = 'running';
      await state.process.start();
      logger.info(`进程已启动: ${name}`);
      this.recordRestart(state);
      this.startHealthCheck(state);

      const registryTaskId = processTaskMap.get(name);
      if (registryTaskId) {
        taskRegistry.updateState(registryTaskId, {
          status: TaskStatus.RUNNING,
        });
        globalEventBus.publish(SystemEvents.TASK_STARTED, {
          taskId: registryTaskId,
          name,
        });
      }

      this.reportProcessCount();
    } catch (error) {
      state.status = 'stopped';
      this.lastError = `启动失败: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`进程启动失败: ${name}`, error as Error);

      const registryTaskId = processTaskMap.get(name);
      if (registryTaskId) {
        taskRegistry.updateState(registryTaskId, {
          status: TaskStatus.FAILED,
          error: this.lastError,
          endTime: Date.now(),
        });
        globalEventBus.publish(SystemEvents.TASK_FAILED, {
          taskId: registryTaskId,
          name,
          error: this.lastError,
        });
      }

      throw error;
    }
  }

  async stop(name: string): Promise<void> {
    const state = this.processes.get(name);
    if (!state || state.status === 'stopped') return;

    state.status = 'stopping';
    this.stopHealthCheck(state);

    let stopError: string | undefined;

    try {
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(
          () => reject(new Error(`进程关闭超时`)),
          this.config.gracefulShutdownTimeout
        );
      });
      await Promise.race([state.process.stop(), timeoutPromise]);
      state.status = 'stopped';
      logger.info(`进程已停止: ${name}`);
    } catch (error) {
      state.status = 'stopped';
      stopError = error instanceof Error ? error.message : String(error);
      logger.error(`进程停止失败: ${name}`, error as Error);
    }

    const registryTaskId = processTaskMap.get(name);
    if (registryTaskId) {
      if (stopError) {
        taskRegistry.updateState(registryTaskId, {
          status: TaskStatus.FAILED,
          endTime: Date.now(),
          error: stopError,
        });
        globalEventBus.publish(SystemEvents.TASK_FAILED, {
          taskId: registryTaskId,
          name,
          error: stopError,
        });
      } else {
        taskRegistry.updateState(registryTaskId, {
          status: TaskStatus.COMPLETED,
          endTime: Date.now(),
        });
        globalEventBus.publish(SystemEvents.TASK_COMPLETED, {
          taskId: registryTaskId,
          name,
        });
      }
    }

    this.reportProcessCount();
  }

  async restart(name: string): Promise<void> {
    logger.info(`进程重启: ${name}`);
    await this.stop(name);
    await this.start(name);
  }

  async startAll(): Promise<void> {
    for (const [name] of this.processes) {
      await this.start(name);
    }
    this.reportProcessCount();
  }

  async stopAll(): Promise<void> {
    const stopPromises: Promise<void>[] = [];
    for (const [name] of this.processes) {
      stopPromises.push(this.stop(name));
    }
    await Promise.all(stopPromises);
    logger.info('所有进程已停止');
    this.reportProcessCount();
  }

  getStatus(name: string): string {
    return this.processes.get(name)?.status ?? 'not_found';
  }

  listStatuses(): Array<{ name: string; status: string }> {
    return Array.from(this.processes.entries()).map(([name, state]) => ({
      name,
      status: state.status,
    }));
  }

  private canRestart(state: ProcessState): boolean {
    const oneMinuteAgo = Date.now() - 60000;
    const recentRestarts = state.lastRestartTimestamps.filter(
      (t) => t > oneMinuteAgo
    );
    return recentRestarts.length < this.config.maxRestartsPerMinute;
  }

  private recordRestart(state: ProcessState): void {
    state.restartCount++;
    state.lastRestartTimestamps.push(Date.now());
    if (state.lastRestartTimestamps.length > 10) {
      state.lastRestartTimestamps.shift();
    }
  }

  private startHealthCheck(state: ProcessState): void {
    this.stopHealthCheck(state);
    state.healthCheckTimer = setInterval(async () => {
      try {
        const alive = await state.process.healthCheck();
        this.reportHealthCheckResult(state.process.name, alive);
        if (!alive && state.status === 'running') {
          logger.warning(`进程健康检查失败，自动重启: ${state.process.name}`);
          await this.restart(state.process.name);
        }
      } catch (error) {
        logger.error(`健康检查异常: ${state.process.name}`, error as Error);
        this.reportHealthCheckResult(state.process.name, false);
        if (state.status === 'running') {
          await this.restart(state.process.name);
        }
      }
    }, this.config.healthCheckInterval);
  }

  private stopHealthCheck(state: ProcessState): void {
    if (state.healthCheckTimer) {
      clearInterval(state.healthCheckTimer);
      state.healthCheckTimer = undefined;
    }
  }

  private reportProcessCount(): void {
    try {
      const monitoring = getMonitoringService();
      const running = Array.from(this.processes.values()).filter(
        (s) => s.status === 'running'
      ).length;
      const stopped = Array.from(this.processes.values()).filter(
        (s) => s.status === 'stopped'
      ).length;
      const total = this.processes.size;
      monitoring.addMetric('daemon.processes.running', running);
      monitoring.addMetric('daemon.processes.stopped', stopped);
      monitoring.addMetric('daemon.processes.total', total);
    } catch (err) {
      // MonitoringService not available, skip metric reporting
    }
  }

  private reportHealthCheckResult(name: string, alive: boolean): void {
    try {
      const monitoring = getMonitoringService();
      monitoring.addMetric(`daemon.healthcheck.${name}`, alive ? 1 : 0);
    } catch (err) {
      // MonitoringService not available, skip metric reporting
    }
  }
}

export function registerHealthHandler(
  ipcService: IPCService,
  processManager: ProcessManager,
  getQueueDepth?: () => number
): void {
  ipcService.on('daemon.health', async () => {
    const depth = getQueueDepth ? getQueueDepth() : 0;
    return { success: true, data: processManager.getHealth(depth) };
  });
}
