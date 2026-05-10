import { Logger } from '../monitoring/logs/Logger';
import { getMonitoringService } from '../monitoring/MonitoringService';

const logger = new Logger({ level: 'info' as any });

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

export class ProcessManager {
  private processes: Map<string, ProcessState>;
  private config: ProcessConfig;

  constructor(config: Partial<ProcessConfig> = {}) {
    this.processes = new Map();
    this.config = { ...DEFAULT_CONFIG, ...config };
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
      this.reportProcessCount();
    } catch (error) {
      state.status = 'stopped';
      logger.error(`进程启动失败: ${name}`, error as Error);
      throw error;
    }
  }

  async stop(name: string): Promise<void> {
    const state = this.processes.get(name);
    if (!state || state.status === 'stopped') return;

    state.status = 'stopping';
    this.stopHealthCheck(state);

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
      logger.error(`进程停止失败: ${name}`, error as Error);
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
    } catch {
      // MonitoringService not available, skip metric reporting
    }
  }

  private reportHealthCheckResult(name: string, alive: boolean): void {
    try {
      const monitoring = getMonitoringService();
      monitoring.addMetric(`daemon.healthcheck.${name}`, alive ? 1 : 0);
    } catch {
      // MonitoringService not available, skip metric reporting
    }
  }
}
