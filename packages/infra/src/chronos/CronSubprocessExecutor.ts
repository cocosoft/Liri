/**
 * Cron 子进程隔离执行器
 * 对标 Hermes cron/scheduler.py
 * 让定时任务运行在子进程中增强隔离性
 */
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';

/**
 * 子进程任务配置
 */
export interface SubprocessTaskConfig {
  taskId: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

/**
 * 子进程任务结果
 */
export interface SubprocessTaskResult {
  taskId: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  success: boolean;
  signal: string | null;
  attempt: number;
}

/**
 * 子进程任务状态
 */
export type SubprocessStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout'
  | 'killed';

/**
 * 子进程执行器
 */
export class CronSubprocessExecutor extends EventEmitter {
  private runningTasks: Map<string, ChildProcess> = new Map();
  private results: SubprocessTaskResult[] = [];
  private maxResults: number = 500;

  /**
   * 在子进程中执行任务
   * @param config 任务配置
   * @returns 任务结果
   */
  async execute(config: SubprocessTaskConfig): Promise<SubprocessTaskResult> {
    let lastResult: SubprocessTaskResult | null = null;

    for (let attempt = 1; attempt <= config.maxRetries + 1; attempt++) {
      lastResult = await this.executeOnce(config, attempt);

      if (lastResult.success) break;

      if (attempt <= config.maxRetries) {
        await this.delay(config.retryDelayMs);
      }
    }

    return lastResult!;
  }

  /**
   * 单次执行
   * @param config 配置
   * @param attempt 尝试次数
   * @returns 结果
   */
  private executeOnce(
    config: SubprocessTaskConfig,
    attempt: number
  ): Promise<SubprocessTaskResult> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const child = spawn(config.command, config.args, {
        cwd: config.cwd || process.cwd(),
        env: { ...process.env, ...(config.env || {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
      });

      this.runningTasks.set(config.taskId, child);

      this.emit('taskStarted', {
        taskId: config.taskId,
        pid: child.pid,
        attempt,
      });

      let stdout = '';
      let stderr = '';
      let resolved = false;

      const timeout = setTimeout(() => {
        if (!resolved) {
          child.kill('SIGTERM');
          resolved = true;

          const result: SubprocessTaskResult = {
            taskId: config.taskId,
            exitCode: null,
            stdout,
            stderr,
            durationMs: Date.now() - startTime,
            success: false,
            signal: 'SIGTERM',
            attempt,
          };

          this.addResult(result);
          this.runningTasks.delete(config.taskId);

          this.emit('taskTimeout', {
            taskId: config.taskId,
            durationMs: result.durationMs,
          });
          resolve(result);
        }
      }, config.timeoutMs);

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      child.on('close', (code: number | null, signal: string | null) => {
        clearTimeout(timeout);

        if (resolved) return;
        resolved = true;

        const result: SubprocessTaskResult = {
          taskId: config.taskId,
          exitCode: code,
          stdout,
          stderr,
          durationMs: Date.now() - startTime,
          success: code === 0,
          signal,
          attempt,
        };

        this.addResult(result);
        this.runningTasks.delete(config.taskId);

        this.emit('taskCompleted', {
          taskId: config.taskId,
          exitCode: code,
          durationMs: result.durationMs,
        });
        resolve(result);
      });

      child.on('error', (err: Error) => {
        clearTimeout(timeout);

        if (resolved) return;
        resolved = true;

        const result: SubprocessTaskResult = {
          taskId: config.taskId,
          exitCode: -1,
          stdout,
          stderr: stderr + '\n' + err.message,
          durationMs: Date.now() - startTime,
          success: false,
          signal: null,
          attempt,
        };

        this.addResult(result);
        this.runningTasks.delete(config.taskId);

        this.emit('taskError', { taskId: config.taskId, error: err.message });
        resolve(result);
      });
    });
  }

  /**
   * 终止运行中的任务
   * @param taskId 任务 ID
   * @returns 是否成功终止
   */
  killTask(taskId: string): boolean {
    const child = this.runningTasks.get(taskId);
    if (!child) return false;

    child.kill('SIGTERM');
    this.runningTasks.delete(taskId);

    return true;
  }

  /**
   * 终止所有运行中的任务
   */
  killAll(): void {
    for (const [taskId, child] of this.runningTasks) {
      child.kill('SIGTERM');
    }

    this.runningTasks.clear();
  }

  /**
   * 获取运行中的任务列表
   */
  getRunningTasks(): Array<{ taskId: string; pid: number | undefined }> {
    return Array.from(this.runningTasks.entries()).map(([taskId, child]) => ({
      taskId,
      pid: child.pid,
    }));
  }

  /**
   * 获取运行中任务数
   */
  getRunningCount(): number {
    return this.runningTasks.size;
  }

  /**
   * 获取任务结果历史
   * @param limit 最大条数
   */
  getResults(limit?: number): SubprocessTaskResult[] {
    const sorted = [...this.results].sort(
      (a, b) => b.durationMs - a.durationMs
    );

    return limit ? sorted.slice(0, limit) : sorted;
  }

  /**
   * 获取指定任务的历史
   * @param taskId 任务 ID
   */
  getTaskHistory(taskId: string): SubprocessTaskResult[] {
    return this.results.filter((r) => r.taskId === taskId);
  }

  /**
   * 添加结果到历史
   */
  private addResult(result: SubprocessTaskResult): void {
    this.results.push(result);

    if (this.results.length > this.maxResults) {
      this.results = this.results.slice(-this.maxResults);
    }
  }

  /**
   * 清除历史
   */
  clearResults(): void {
    this.results = [];
  }

  /**
   * 延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * 全局 Cron 子进程执行器
 */
let globalExecutor: CronSubprocessExecutor | null = null;

/**
 * 获取全局 Cron 子进程执行器
 */
export function getCronSubprocessExecutor(): CronSubprocessExecutor {
  if (!globalExecutor) {
    globalExecutor = new CronSubprocessExecutor();
  }

  return globalExecutor;
}
