/**
 * MCP stdio 子进程生命周期追踪器
 *
 * 对标 hermes _kill_orphaned_mcp_children，提供：
 * 1. 活跃子进程注册（按 serverName 索引）
 * 2. 孤儿进程扫描与强制清理
 * 3. 两阶段终止（SIGTERM → 等待 → SIGKILL 兜底）
 *
 * 与 hermes 的区别：我们持有 ChildProcess 引用，不需要 PID 快照。
 */
import { type ChildProcess } from 'child_process';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'services:mcp:process-tracker',
  level: LogLevel.INFO,
});

/** 单个进程追踪条目 */
interface TrackedProcess {
  process: ChildProcess;
  serverName: string;
  pid: number;
  createdAt: number;
}

/** 活跃子进程列表 */
const activeProcesses: TrackedProcess[] = [];

/** 孤儿进程列表（正常 disconnect 后仍存活的） */
const orphanProcesses: Set<number> = new Set();

/**
 * 注册一个子进程
 */
export function trackProcess(
  process: ChildProcess,
  serverName: string
): void {
  const pid = process.pid;
  if (!pid) return;

  activeProcesses.push({
    process,
    serverName,
    pid,
    createdAt: Date.now(),
  });

  logger.debug(`Tracked MCP child process: ${serverName} (PID ${pid})`);

  // 进程退出时自动移除追踪
  process.on('exit', () => {
    untrackByPid(pid);
  });
}

/**
 * 注销一个子进程（正常清理路径）
 * 如果 kill 后进程仍在运行，标记为孤儿
 */
export function untrackProcess(process: ChildProcess): void {
  const pid = process.pid;
  if (!pid) return;

  untrackByPid(pid);

  // 探测进程是否仍存活 → 标记为孤儿
  try {
    process.kill(0); // signal 0 仅探测
    orphanProcesses.add(pid);
    logger.warn(`MCP child process PID ${pid} still alive after kill, marked orphan`);
  } catch {
    // 已退出，正常
  }
}

/**
 * 按 PID 移除追踪
 */
function untrackByPid(pid: number): void {
  const idx = activeProcesses.findIndex((p) => p.pid === pid);
  if (idx >= 0) {
    activeProcesses.splice(idx, 1);
  }
  orphanProcesses.delete(pid);
}

/**
 * 两阶段终止一个进程
 * Phase 1: SIGTERM（优雅退出）
 * Phase 2: 等待 gracePeriodMs
 * Phase 3: SIGKILL 兜底
 *
 * @returns 最终进程是否已退出
 */
function twoPhaseKill(
  proc: ChildProcess,
  gracePeriodMs: number = 2000
): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;

    const finish = (exited: boolean) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(sigkillTimer);
      resolve(exited);
    };

    // Phase 1: SIGTERM
    try {
      proc.kill('SIGTERM');
    } catch {
      finish(false);
      return;
    }

    // 监听退出
    proc.once('exit', () => finish(true));

    // Phase 2 & 3: 等待后 SIGKILL
    const sigkillTimer = setTimeout(() => {
      try {
        proc.kill(0); // 探测
        // 还活着 → SIGKILL
        try {
          proc.kill('SIGKILL');
        } catch {
          // Windows 上 kill('SIGKILL') 不可用，用 kill()
          proc.kill();
        }
        proc.once('exit', () => finish(true));

        // 最终超时
        setTimeout(() => finish(false), 1000);
      } catch {
        finish(true); // signal 0 抛出 = 进程已死
      }
    }, gracePeriodMs);
  });
}

/**
 * 强制清理所有进程
 * @param includeActive 是否清理活跃进程（仅 shutdown 时使用）
 * @param serverName 可选按 serverName 过滤
 */
export async function killOrphanedProcesses(
  includeActive: boolean = false,
  serverName?: string
): Promise<{ killed: number; failed: number }> {
  let killed = 0;
  let failed = 0;

  // 收集待处理的进程
  const targets: TrackedProcess[] = [];

  if (includeActive) {
    // 清理所有进程（shutdown 路径）
    targets.push(...activeProcesses);
  }

  // 清理孤儿进程
  for (const pid of orphanProcesses) {
    const tracked = activeProcesses.find((p) => p.pid === pid);
    if (tracked && (!serverName || tracked.serverName === serverName)) {
      targets.push(tracked);
    }
  }

  for (const entry of targets) {
    const exited = await twoPhaseKill(entry.process);
    if (exited) {
      killed++;
      untrackByPid(entry.pid);
      logger.info(
        `MCP orphan process killed: ${entry.serverName} (PID ${entry.pid})`
      );
    } else {
      failed++;
      logger.warn(
        `MCP orphan process kill failed: ${entry.serverName} (PID ${entry.pid})`
      );
    }
  }

  if (killed > 0 || failed > 0) {
    logger.info(
      `MCP orphan cleanup: ${killed} killed, ${failed} failed`
    );
  }

  return { killed, failed };
}

/**
 * 获取当前活跃进程数
 */
export function getActiveProcessCount(): number {
  return activeProcesses.length;
}

/**
 * 获取孤儿进程 PID 列表
 */
export function getOrphanPids(): number[] {
  return Array.from(orphanProcesses);
}

/**
 * 清除所有追踪（仅测试用）
 */
export function clearAllTracking(): void {
  activeProcesses.length = 0;
  orphanProcesses.clear();
}
