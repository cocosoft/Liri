import { fork } from 'child_process';
import { getLogger } from '@modules/monitoring';
import { join } from 'path';
import { resolveProjectRoot } from '@modules/core';

const logger = getLogger('tasks:detachedRuntime');

export interface DetachedTaskConfig {
  taskId: string;
  modulePath: string;
  args?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface DetachedTaskResult {
  taskId: string;
  success: boolean;
  output: unknown;
  durationMs: number;
  error?: string;
}

export class DetachedTaskRuntime {
  private processes: Map<
    string,
    { child: ReturnType<typeof fork>; startTime: number }
  > = new Map();

  async run(config: DetachedTaskConfig): Promise<DetachedTaskResult> {
    const startTime = Date.now();
    const modulePath = join(resolveProjectRoot(), config.modulePath);

    return new Promise((resolve) => {
      const child = fork(modulePath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        timeout: config.timeoutMs ?? 30000,
      });

      this.processes.set(config.taskId, { child, startTime });

      let output: unknown = null;

      child.on('message', (msg: unknown) => {
        output = msg;
      });

      const done = (success: boolean, error?: string) => {
        this.processes.delete(config.taskId);
        resolve({
          taskId: config.taskId,
          success,
          output,
          durationMs: Date.now() - startTime,
          error,
        });
      };

      child.on('exit', (code) => {
        done(code === 0);
      });

      child.on('error', (err) => {
        done(false, err.message);
      });

      child.send(config);
    });
  }

  isRunning(taskId: string): boolean {
    return this.processes.has(taskId);
  }

  getActiveCount(): number {
    return this.processes.size;
  }

  terminate(taskId: string): boolean {
    const entry = this.processes.get(taskId);
    if (!entry) return false;
    entry.child.kill();
    this.processes.delete(taskId);
    return true;
  }
}
