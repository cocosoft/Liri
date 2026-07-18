// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * Agent CLI Runner
 * 对标OpenClaw agents/cli-runner/
 * bundle-mcp/execute/reliability
 */

import { execSync, spawn, type ChildProcess } from 'child_process';
import { configManager } from '@modules/config';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'agent:cli-runner:index', level: LogLevel.INFO });

export type CliRunnerMode = 'direct' | 'bundle-mcp' | 'pipe';

export interface CliRunnerOptions {
  mode?: CliRunnerMode;
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
  shell?: boolean;
  maxBuffer?: number;
}

export interface CliExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  duration: number;
  command: string;
}

export interface CliExecutionStats {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  totalDuration: number;
  avgDuration: number;
}

export class CliRunner {
  private options: Required<CliRunnerOptions>;
  private stats: CliExecutionStats;
  private activeProcesses: Map<string, ChildProcess> = new Map();

  constructor(options?: CliRunnerOptions) {
    this.options = {
      mode: options?.mode ?? 'direct',
      timeout: options?.timeout ?? 30000,
      cwd: options?.cwd ?? process.cwd(),
      env: options?.env ?? {},
      shell: options?.shell ?? true,
      maxBuffer: options?.maxBuffer ?? 10 * 1024 * 1024,
    };

    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      totalDuration: 0,
      avgDuration: 0,
    };
  }

  async execute(
    command: string,
    options?: Partial<CliRunnerOptions>
  ): Promise<CliExecutionResult> {
    const opts = { ...this.options, ...options };
    const startTime = Date.now();

    this.stats.totalExecutions++;

    try {
      const shellPath = opts.shell
        ? configManager.env('ComSpec') ||
          configManager.env('SHELL') ||
          'cmd.exe'
        : undefined;

      const stdout = execSync(command, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        timeout: opts.timeout,
        shell: shellPath,
        maxBuffer: opts.maxBuffer,
        encoding: 'utf-8',
      });

      const duration = Date.now() - startTime;
      this.stats.successfulExecutions++;
      this.updateAvgDuration(duration);

      return {
        stdout: stdout.trim(),
        stderr: '',
        exitCode: 0,
        duration,
        command,
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.stats.failedExecutions++;
      this.updateAvgDuration(duration);

      return {
        stdout: error.stdout?.toString().trim() ?? '',
        stderr: error.stderr?.toString().trim() ?? error.message,
        exitCode: error.status ?? -1,
        duration,
        command,
      };
    }
  }

  async executeBundleMCP(
    toolName: string,
    args: Record<string, unknown>,
    options?: Partial<CliRunnerOptions>
  ): Promise<CliExecutionResult> {
    const argsJson = JSON.stringify(args);
    const command = `bun run mcp ${toolName} --args '${argsJson}'`;
    return this.execute(command, options);
  }

  spawnProcess(
    id: string,
    command: string,
    args: string[],
    options?: { cwd?: string; env?: Record<string, string> }
  ): ChildProcess {
    const proc = spawn(command, args, {
      cwd: options?.cwd ?? this.options.cwd,
      env: { ...process.env, ...options?.env },
      shell: this.options.shell,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.activeProcesses.set(id, proc);

    proc.on('exit', () => {
      this.activeProcesses.delete(id);
    });

    return proc;
  }

  async executeWithRetry(
    command: string,
    maxRetries: number = 3,
    options?: Partial<CliRunnerOptions>
  ): Promise<CliExecutionResult> {
    let lastError: CliExecutionResult | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }

      const result = await this.execute(command, options);

      if (result.exitCode === 0) {
        return result;
      }

      lastError = result;
    }

    return lastError!;
  }

  async executeWithTimeout(
    command: string,
    timeoutMs: number,
    options?: Partial<CliRunnerOptions>
  ): Promise<CliExecutionResult> {
    return this.execute(command, { ...options, timeout: timeoutMs });
  }

  killProcess(id: string): boolean {
    const proc = this.activeProcesses.get(id);
    if (!proc || !proc.pid) return false;

    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /PID ${proc.pid} /F /T`, { stdio: 'ignore' });
      } else {
        process.kill(-proc.pid, 'SIGTERM');
      }
      this.activeProcesses.delete(id);
      return true;
    } catch {
      return false;
    }
  }

  killAllProcesses(): void {
    for (const id of this.activeProcesses.keys()) {
      this.killProcess(id);
    }
  }

  getActiveProcessCount(): number {
    return this.activeProcesses.size;
  }

  getStats(): CliExecutionStats {
    return { ...this.stats };
  }

  setCwd(cwd: string): void {
    this.options.cwd = cwd;
  }

  private updateAvgDuration(duration: number): void {
    const total = this.stats.totalExecutions;
    this.stats.totalDuration += duration;
    this.stats.avgDuration = total > 0 ? this.stats.totalDuration / total : 0;
  }
}

export function createCliRunner(options?: CliRunnerOptions): CliRunner {
  return new CliRunner(options);
}
