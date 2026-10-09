/**
 * PTY 伪终端沙箱
 * 支持交互式命令执行
 * 对齐 OpenClaw agents/bash-tools.exec-runtime.ts
 */

import type {
  SandboxExecuteOptions,
  SandboxExecuteResult,
} from './SandboxTypes';
import { getLogger } from '@modules/monitoring';
import { spawn, type ChildProcess } from 'child_process';
import { appendWithinLimit, resolveOutputLimit } from './SandboxPolicy';

const logger = getLogger('sandbox:pTYSandbox');

export interface PTYSandboxConfig {
  shell: string;
  timeoutMs: number;
  /**
   * **软**输出上限。**不传**时取 `SandboxPolicy` 的**唯一来源**（B1：后端不另设默认值）。
   */
  maxOutputBytes?: number;
  cwd: string;
  env: Record<string, string>;
}

const DEFAULT_PTY_CONFIG: PTYSandboxConfig = {
  shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/bash',
  timeoutMs: 300000,
  // B1（2026-09-26）：删掉就地的 `maxOutputBytes: 1024*1024` —— 改由 resolveOutputLimit 取唯一来源
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
      const shellArgs =
        process.platform === 'win32' ? ['-Command', command] : ['-c', command];

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

      // B1：软上限经**唯一来源**解析；同时统计被丢弃的字节数（供结果程序化上报）
      const { soft: maxBytes } = resolveOutputLimit({
        soft: this.config.maxOutputBytes,
      });
      let droppedBytes = 0;

      // B1：逐块**按剩余量切片**（旧写法"未超限就整块追加"会突破上限且不可确定性判定）
      child.stdout?.on('data', (data: Buffer) => {
        const step = appendWithinLimit(
          stdout,
          data.toString('utf-8'),
          maxBytes
        );
        stdout = step.text;
        droppedBytes += step.droppedBytes;
      });

      child.stderr?.on('data', (data: Buffer) => {
        const step = appendWithinLimit(
          stderr,
          data.toString('utf-8'),
          maxBytes
        );
        stderr = step.text;
        droppedBytes += step.droppedBytes;
      });

      child.on('close', (code: number | null, signal: string | null) => {
        clearTimeout(timeout);
        this.processes.delete(procId);

        const truncated = droppedBytes > 0;

        resolve({
          exitCode: code ?? (signal ? 1 : 0),
          stdout: truncated
            ? stdout.slice(0, maxBytes) + '\n[输出已截断]'
            : stdout,
          stderr: truncated ? stderr.slice(0, maxBytes) : stderr,
          executionTime: Date.now() - startTime,
          success: !timedOut && code === 0,
          // B1（③）：此前 `truncated` 只写进 stdout 文案，调用方无法程序化判断
          truncated,
          truncatedBytes: droppedBytes,
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
