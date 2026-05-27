/**
 * Agent CLI Runner
 * 对标OpenClaw agents/cli-runner/
 * bundle-mcp/execute/reliability
 */

import { execSync, spawn, type ChildProcess } from 'node:child_process';

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
        ? process.env.ComSpec || process.env.SHELL || 'cmd.exe'
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
