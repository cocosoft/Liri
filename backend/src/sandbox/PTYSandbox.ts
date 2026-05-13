/**
 * PTY 伪终端沙箱
 * 支持交互式命令执行
 * 对齐 OpenClaw agents/bash-tools.exec-runtime.ts
 */

import type { SandboxExecuteOptions, SandboxExecuteResult } from './types/SandboxTypes';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { spawn, type ChildProcess } from 'node:child_process';

const logger = new Logger({ level: LogLevel.INFO });

export interface PTYSandboxConfig {
  shell: string;
  timeoutMs: number;
  maxOutputBytes: number;
  cwd: string;
  env: Record<string, string>;
}

const DEFAULT_PTY_CONFIG: PTYSandboxConfig = {
  shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
  timeoutMs: 300000,
  maxOutputBytes: 1024 * 1024,
  cwd: process.cwd(),
  env: {},
};

export class PTYSandbox {
  private config: PTYSandboxConfig;
  private processes: Map<string, ChildProcess> = new Map();

  constructor(config: Partial<PTYSandboxConfig> = {}) {
    this.config = { ...DEFAULT_PTY_CONFIG, ...config };
  }

  async execute(options: SandboxExecuteOptions): Promise<SandboxExecuteResult> {
    const startTime = Date.now();
    const command = options.args.join(' ');

    return new Promise((resolve) => {
      const shell = this.config.shell;
      const shellArgs = process.platform === 'win32' ? ['-Command', command] : ['-c', command];

      const child = spawn(shell, shellArgs, {
        cwd: options.cwd || this.config.cwd,
        env: { ...process.env, ...this.config.env, ...options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });

      const procId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      this.processes.set(procId, child);

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (child.exitCode === null) {
            child.kill('SIGKILL');
          }
        }, 5000);
      }, options.timeout || this.config.timeoutMs);

      const maxBytes = this.config.maxOutputBytes;

      child.stdout?.on('data', (data: Buffer) => {
        if (stdout.length < maxBytes) {
          stdout += data.toString('utf-8');
        }
      });

      child.stderr?.on('data', (data: Buffer) => {
        if (stderr.length < maxBytes) {
          stderr += data.toString('utf-8');
        }
      });

      child.on('close', (code: number | null, signal: string | null) => {
        clearTimeout(timeout);
        this.processes.delete(procId);

        const durationMs = Date.now() - startTime;
        const truncated = stdout.length >= maxBytes || stderr.length >= maxBytes;

        resolve({
          exitCode: code ?? (signal ? 1 : 0),
          stdout: truncated ? stdout.slice(0, maxBytes) + '\n[输出已截断]' : stdout,
          stderr: truncated ? stderr.slice(0, maxBytes) : stderr,
          executionTime: Date.now() - startTime,
          success: !timedOut && code === 0,
        });
      });

      child.on('error', (error: Error) => {
        clearTimeout(timeout);
        this.processes.delete(procId);

        resolve({
          exitCode: 1,
          stdout: '',
          stderr: error.message,
          executionTime: Date.now() - startTime,
          success: false,
          error: error.message,
        });
      });

      // 如果有输入数据，写入 stdin
      if (options.input) {
        child.stdin?.write(options.input);
        child.stdin?.end();
      }
    });
  }

  killProcess(procId: string, signal: NodeJS.Signals = 'SIGTERM'): boolean {
    const proc = this.processes.get(procId);
    if (proc) {
      return proc.kill(signal);
    }
    return false;
  }

  killAll(signal: NodeJS.Signals = 'SIGTERM'): void {
    for (const [id, proc] of this.processes) {
      proc.kill(signal);
      logger.info(`PTY 进程 ${id} 已发送 ${signal}`);
    }
    this.processes.clear();
  }

  getActiveProcessCount(): number {
    return this.processes.size;
  }
}
