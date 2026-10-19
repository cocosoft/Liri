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
  /** 进入终态的时间（running 期间为空） */
  completedAt?: number;
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

    // N4（2026-10-19）：PID 复用防护。同一 PID 仍以 `running` 存在，说明旧进程
    // 已消失但终态未回写（OS 复用该 PID）⇒ 旧条目先标记为 error，避免 active 数虚高。
    for (const [oldId, oldProc] of this.processes) {
      if (oldProc.pid !== procInfo.pid || oldProc.status !== 'running') {
        continue;
      }
      oldProc.status = 'error';
      oldProc.completedAt = Date.now();
      oldProc.metadata = {
        ...oldProc.metadata,
        supersededByPidReuse: true,
        supersededAt: Date.now(),
      };
      this.processes.set(oldId, oldProc);
      logger.warning('检出 PID 复用：旧登记项标记为 error', {
        pid: procInfo.pid,
        oldId,
        oldCommand: oldProc.command,
        newCommand: procInfo.command,
      });
    }

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
    proc.completedAt = status === 'running' ? undefined : Date.now();
    if (exitCode !== undefined) proc.exitCode = exitCode;
    this.processes.set(id, proc);
    return true;
  }

  /**
   * 以终态收敛一条登记（`updateStatus` 的语义别名）。
   *
   * 说明：**不删除**条目 —— 删除会让 `getStats()` 的 completed/killed 失去意义；
   * 历史由 `pruneTerminal()` / `trim()` 有界回收，运行中条目永不被淘汰。
   */
  complete(
    id: string,
    status: Exclude<ProcessInfo['status'], 'running'>,
    exitCode?: number
  ): boolean {
    return this.updateStatus(id, status, exitCode);
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

  /** 活跃进程数（`getRunningCount` 的语义别名，供不变量断言使用） */
  getActiveCount(): number {
    return this.getRunningCount();
  }

  /** 是否已无活跃进程（N4「活动数归零」不变式） */
  isIdle(): boolean {
    return this.getRunningCount() === 0;
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

  /**
   * 回收过期终态条目（N4：有界历史）。
   *
   * **运行中条目永不删除**；`olderThanMs` 非正数 ⇒ 不做事。
   * @returns 实际删除数量
   */
  pruneTerminal(olderThanMs: number): number {
    if (!Number.isFinite(olderThanMs) || olderThanMs <= 0) return 0;
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;
    for (const [id, proc] of [...this.processes]) {
      if (proc.status === 'running') continue;
      const terminalAt = proc.completedAt ?? proc.startTime;
      if (terminalAt >= cutoff) continue;
      this.processes.delete(id);
      removed++;
    }
    if (removed > 0) {
      logger.debug(`进程注册表回收终态条目: ${removed}`);
    }
    return removed;
  }

  trim(): void {
    // N4（2026-10-19）：只淘汰**终态**条目，运行中进程不得被统计压力挤掉。
    const terminalOldestFirst = Array.from(this.processes.entries())
      .filter(([, proc]) => proc.status !== 'running')
      .sort(
        ([, a], [, b]) =>
          (a.completedAt ?? a.startTime) - (b.completedAt ?? b.startTime)
      );

    const removeCount = Math.max(1, Math.floor(this.processes.size * 0.3));
    const removable = terminalOldestFirst.slice(0, removeCount);
    if (removable.length === 0) {
      logger.warning('进程注册表达到上限但无终态条目可修剪（保留运行中进程）', {
        size: this.processes.size,
        maxEntries: this.maxEntries,
      });
      return;
    }

    for (const [id] of removable) {
      this.processes.delete(id);
    }

    logger.info(
      `进程注册表自动修剪: 移除 ${removable.length} 个终态条目（运行中 ${this.getRunningCount()} 个保留）`
    );
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
