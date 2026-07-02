/**
 * 进程看门狗
 * 监控守护进程，崩溃自动重启
 * 对齐 OpenClaw gateway watchdog
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { spawn, type ChildProcess } from 'node:child_process';

const logger = new Logger({
  module: 'daemon:processWatchdog',
  level: LogLevel.INFO,
});

export interface WatchdogConfig {
  command: string;
  args: string[];
  restartLimitPerMinute: number;
  minUptimeMs: number;
  cwd?: string;
  env?: Record<string, string>;
}

export interface WatchdogStatus {
  pid: number | null;
  running: boolean;
  restartCount: number;
  totalRestarts: number;
  lastRestartTime: number | null;
  uptime: number;
  cause?: string;
}

export class ProcessWatchdog {
  private config: WatchdogConfig;
  private process: ChildProcess | null = null;
  private watcher: ReturnType<typeof setInterval> | null = null;
  private restartTimes: number[] = [];
  private totalRestarts = 0;
  private startTime = 0;

  constructor(config: WatchdogConfig) {
    this.config = config;
  }

  start(onRestart?: (status: WatchdogStatus) => void): void {
    if (this.process) {
      logger.warning('看门狗已在运行');
      return;
    }
    this.launch();
    this.watcher = setInterval(() => {
      this.monitor(onRestart);
    }, 5000);
    logger.info(
      `进程看门狗已启动: ${this.config.command} ${this.config.args.join(' ')}`
    );
  }

  stop(): void {
    if (this.watcher) {
      clearInterval(this.watcher);
      this.watcher = null;
    }
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    logger.info('进程看门狗已停止');
  }

  getStatus(): WatchdogStatus {
    return {
      pid: this.process?.pid ?? null,
      running: !!this.process && this.process.exitCode === null,
      restartCount: this.restartTimes.length,
      totalRestarts: this.totalRestarts,
      lastRestartTime:
        this.restartTimes.length > 0
          ? this.restartTimes[this.restartTimes.length - 1]
          : null,
      uptime: this.startTime > 0 ? Date.now() - this.startTime : 0,
    };
  }

  private launch(): void {
    this.startTime = Date.now();
    this.process = spawn(this.config.command, this.config.args, {
      cwd: this.config.cwd,
      env: { ...process.env, ...this.config.env },
      stdio: 'pipe',
      shell: false,
    });

    this.process.on('exit', (code, signal) => {
      const cause = signal ? `信号: ${signal}` : `退出码: ${code}`;
      logger.warning(`进程退出 (${cause}), 将在下次检测中评估重启`);
    });

    if (this.process.stdout) {
      this.process.stdout.on('data', (data: Buffer) => {
        logger.debug(`[STDOUT] ${data.toString('utf-8').trim()}`);
      });
    }
    if (this.process.stderr) {
      this.process.stderr.on('data', (data: Buffer) => {
        logger.warning(`[STDERR] ${data.toString('utf-8').trim()}`);
      });
    }
  }

  private monitor(onRestart?: (status: WatchdogStatus) => void): void {
    if (!this.process) return;

    if (this.process.exitCode !== null) {
      const now = Date.now();
      const minRestartWindow = 60000;

      // 清除超过窗口的旧重启时间
      this.restartTimes = this.restartTimes.filter(
        (t) => now - t < minRestartWindow
      );

      if (this.restartTimes.length < this.config.restartLimitPerMinute) {
        this.restartTimes.push(now);
        this.totalRestarts++;
        logger.warning(`进程重启 (第 ${this.totalRestarts} 次)`);

        this.launch();

        if (onRestart) {
          onRestart(this.getStatus());
        }
      } else {
        logger.error(
          `超过重启限制 (${this.config.restartLimitPerMinute}次/分钟)，停止重试`
        );
        if (this.watcher) {
          clearInterval(this.watcher);
          this.watcher = null;
        }
      }
    }
  }
}
