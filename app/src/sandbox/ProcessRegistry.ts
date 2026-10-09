/**
 * 进程注册表
 *
 * **职责边界（R21 订正，2026-10-09）**：本类**只做观测/查询**（登记 → 更新终态 → 查询/统计），
 * **不持有子进程句柄、不具备 kill/signal 能力**。（原头注释写"支持 kill/signal"**失实**——
 * 注册项仅存 `{pid, command, startTime, status, exitCode}` 数据，杀进程由**执行侧**负责。）
 *
 * 终止进程请用 `killProcessTree()`（`sandbox/utils/killProcessTree.ts`）：取消/中止时按**进程树**强杀。
 * 对齐 OpenClaw agents/bash-process-registry.ts
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('sandbox:processRegistry');

export interface ProcessInfo {
  pid: number;
  command: string;
  startTime: number;
  status: 'running' | 'completed' | 'killed' | 'timed_out' | 'error';
  exitCode?: number;
  sandboxId?: string;
  metadata?: Record<string, unknown>;
}

export interface ProcessQuery {
  status?: 'running' | 'completed' | 'killed' | 'timed_out' | 'error';
  sandboxId?: string;
  maxAgeMs?: number;
}

export class ProcessRegistry {
  private processes: Map<string, ProcessInfo> = new Map();
  private maxEntries: number;

  constructor(maxEntries: number = 1000) {
    this.maxEntries = maxEntries;
  }

  register(procInfo: Omit<ProcessInfo, 'startTime'>): string {
    const id = `proc-${procInfo.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    if (this.processes.size >= this.maxEntries) {
      this.trim();
    }

    this.processes.set(id, { ...procInfo, startTime: Date.now() });
    logger.debug(
      `进程已注册: ${id} (PID: ${procInfo.pid}, 命令: ${procInfo.command})`
    );
    return id;
  }

  updateStatus(
    id: string,
    status: ProcessInfo['status'],
    exitCode?: number
  ): boolean {
    const proc = this.processes.get(id);
    if (!proc) return false;

    proc.status = status;
    if (exitCode !== undefined) proc.exitCode = exitCode;
    this.processes.set(id, proc);
    return true;
  }

  getProcess(id: string): ProcessInfo | undefined {
    return this.processes.get(id);
  }

  query(query: ProcessQuery): ProcessInfo[] {
    let results = Array.from(this.processes.values());

    if (query.status) {
      results = results.filter((p) => p.status === query.status);
    }
    if (query.sandboxId) {
      results = results.filter((p) => p.sandboxId === query.sandboxId);
    }
    if (query.maxAgeMs) {
      const cutoff = Date.now() - query.maxAgeMs;
      results = results.filter((p) => p.startTime >= cutoff);
    }

    return results;
  }

  getRunningCount(): number {
    let count = 0;
    for (const [, proc] of this.processes) {
      if (proc.status === 'running') count++;
    }
    return count;
  }

  getBySandbox(sandboxId: string): ProcessInfo[] {
    return this.query({ sandboxId });
  }

  removeProcess(id: string): boolean {
    return this.processes.delete(id);
  }

  clear(): void {
    const count = this.processes.size;
    this.processes.clear();
    logger.info(`进程注册表已清空 (${count} 个进程)`);
  }

  trim(): void {
    const oldestFirst = Array.from(this.processes.entries()).sort(
      ([, a], [, b]) => a.startTime - b.startTime
    );

    const removeCount = Math.floor(this.processes.size * 0.3);
    for (let i = 0; i < removeCount; i++) {
      if (oldestFirst[i]) {
        this.processes.delete(oldestFirst[i][0]);
      }
    }

    logger.info(`进程注册表自动修剪: 移除 ${removeCount} 个旧条目`);
  }

  getStats(): {
    total: number;
    running: number;
    completed: number;
    killed: number;
    errors: number;
  } {
    let running = 0;
    let completed = 0;
    let killed = 0;
    let errors = 0;

    for (const [, proc] of this.processes) {
      switch (proc.status) {
        case 'running':
          running++;
          break;
        case 'completed':
          completed++;
          break;
        case 'killed':
        case 'timed_out':
          killed++;
          break;
        case 'error':
          errors++;
          break;
      }
    }

    return { total: this.processes.size, running, completed, killed, errors };
  }
}

export const processRegistry = new ProcessRegistry();
