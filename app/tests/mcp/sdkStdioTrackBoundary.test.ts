/**
 * P2-8 —— MCP **双轨子进程**回收边界契约测试（2026-10-10）。
 *
 * 依据：`dev_docs/20261010/升级优化方案-20261010.md` §3 **P2-8**（外部核验项 M-15）；
 * 裁定与依据见 `.trae/specs/mcp-client-dual-track-convergence-assessment.md` §11。
 *
 * 背景（回仓取证）：
 * - **自研轨**（`StdioTransport` → `ChildProcessTracker.trackProcess`）由 `killOrphanedProcesses`
 *   两阶段兜底回收（`services/mcp/index.ts#cleanup`）。
 * - **SDK 轨**（`client.ts` → `StdioClientTransport`，内部 `cross-spawn`）**不在**该追踪器内：
 *   SDK 只公开 `pid` / `stderr`，**不公开子进程句柄**（`_process` 是 TS-private）⇒ 无法喂给
 *   `ChildProcessTracker`（其设计基于持有 `ChildProcess` 引用做两阶段终止）。
 *
 * 本文件**把该边界变成可执行断言**（而非仅写在注释里）：
 * 1. **前提**：SDK 无公开子进程句柄（若未来 SDK 暴露 ⇒ 本测试失败 ⇒ 触发重评「是否并入追踪器」）；
 * 2. **行为**：SDK 子进程存活时 `ChildProcessTracker` **计数为 0**（双轨边界），
 *    且 `transport.close()`（= `closeAll()` 所用机制）能**真正回收**该子进程；
 * 3. **端到端**：两轨子进程**并存**时，按生产回收顺序（SDK 轨 `close()` → 自研轨 `killOrphanedProcesses`）
 *    两个 PID **均被回收**、追踪计数归 0（P2-8 验收口径）。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import {
  clearAllTracking,
  getActiveProcessCount,
  killOrphanedProcesses,
} from '../../src/services/mcp/transports/ChildProcessTracker';
import { StdioTransport } from '../../src/services/mcp/transports/StdioTransport';

const CHILD = join(import.meta.dir, 'fixtures/mcpIdleChild.js');

/** 探活（signal 0 仅探测；抛错 = 进程已不存在） */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 轮询等待进程退出（避免依赖单次探测的时序） */
async function waitDead(pid: number, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isAlive(pid)) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}

afterEach(() => clearAllTracking());

describe('P2-8 MCP 双轨子进程 · SDK 轨回收边界', () => {
  it('前提：SDK `StdioClientTransport` **不公开**子进程句柄（仅 pid/stderr）', () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CHILD],
      stderr: 'ignore',
    });

    // 公开 API 面：start / close / send + pid / stderr
    expect(typeof transport.start).toBe('function');
    expect(typeof transport.close).toBe('function');
    expect(typeof transport.send).toBe('function');
    expect(transport.pid).toBeNull(); // 未 start ⇒ 无子进程
    expect(transport.stderr).toBeNull();

    // 无**公开**的子进程句柄（`process` / `child` 不存在） ⇒ 无法喂给 ChildProcessTracker。
    // 若将来 SDK 暴露公开句柄，本断言失败 ⇒ 触发重评「SDK 轨是否并入追踪器」。
    const surface = transport as unknown as Record<string, unknown>;
    expect(surface.process).toBeUndefined();
    expect(surface.child).toBeUndefined();
  });

  it('行为：SDK 子进程存活时 tracker 计数为 0（双轨边界），且 `close()` 能回收之', async () => {
    clearAllTracking();

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [CHILD],
      stderr: 'ignore',
    });

    await transport.start();
    const pid = transport.pid;
    expect(typeof pid).toBe('number');

    // 边界：SDK 轨子进程**在 tracker 之外**（这正是「双轨并存」的可执行证据）
    expect(getActiveProcessCount()).toBe(0);
    expect(isAlive(pid as number)).toBe(true);

    // `MCPServerManager.closeAll()` 对 SDK 轨用的就是 `transport.close()`
    // （2s → SIGTERM → 2s → SIGKILL；本夹具在 stdin end 后即退出）
    await transport.close();
    await waitDead(pid as number);
    expect(isAlive(pid as number)).toBe(false);
  });

  it('边界登记：`cleanup()` 中 SDK 轨关闭（`closeAll`）先于自研轨兜底（`killOrphanedProcesses`）', () => {
    // 顺序即「SDK 轨由 closeAll 承接、自研轨由追踪器兜底」这一裁定的代码落点。
    const src = readFileSync(
      join(import.meta.dir, '../../src/services/mcp/index.ts'),
      'utf-8'
    );
    const iSdkClose = src.indexOf('await mcpConnectionManager.closeAll()');
    const iSdkManagerClose = src.indexOf(
      'await getMCPServerManager().closeAll()'
    );
    const iReap = src.indexOf('killOrphanedProcesses(true)');

    expect(iSdkClose).toBeGreaterThan(-1);
    expect(iSdkManagerClose).toBeGreaterThan(-1);
    expect(iReap).toBeGreaterThan(-1);
    // 先关两轨连接（SDK client.close / 自研 close），**再**兜底回收
    expect(iSdkClose).toBeLessThan(iReap);
    expect(iSdkManagerClose).toBeLessThan(iReap);
  });

  it('端到端：两轨子进程并存，异常退出路径（生产回收顺序）两 PID 均被回收', async () => {
    clearAllTracking();

    // 轨 ①：SDK 轨 —— `client.ts` 所用 `StdioClientTransport`（`cross-spawn`，**不在**追踪器内）
    const sdkTransport = new StdioClientTransport({
      command: process.execPath,
      args: [CHILD],
      stderr: 'ignore',
    });

    // 轨 ②：自研轨 —— `StdioTransport.connect()` 内 `trackProcess`（登记进追踪器）
    const ownTransport = new StdioTransport({
      command: process.execPath,
      args: [CHILD],
    });

    try {
      await sdkTransport.start();
      await ownTransport.connect();

      const sdkPid = sdkTransport.pid as number;
      const ownPid = (
        ownTransport as unknown as { process: { pid: number } | null }
      ).process?.pid as number;

      expect(typeof sdkPid).toBe('number');
      expect(typeof ownPid).toBe('number');
      expect(sdkPid).not.toBe(ownPid);

      // 「双轨并存」的可执行证据：两子进程都存活，但追踪器**只认自研轨那一个**
      expect(isAlive(sdkPid)).toBe(true);
      expect(isAlive(ownPid)).toBe(true);
      expect(getActiveProcessCount()).toBe(1);

      // ── 生产回收顺序（`services/mcp/index.ts#cleanup`）：SDK 轨 `close()` 先于自研轨兜底
      await sdkTransport.close();
      await waitDead(sdkPid);
      expect(isAlive(sdkPid)).toBe(false);

      const reclaimed = await killOrphanedProcesses(true);
      expect(reclaimed.killed).toBe(1);
      await waitDead(ownPid);
      expect(isAlive(ownPid)).toBe(false);
      expect(getActiveProcessCount()).toBe(0);
    } finally {
      // 断言失败时兜底，避免子进程泄漏污染其他用例
      await sdkTransport.close().catch(() => {});
      ownTransport.disconnect();
      clearAllTracking();
    }
  });
});
