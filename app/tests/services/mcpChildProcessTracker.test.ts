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
 * ① P0 MCP stdio 子进程**受管化**回归测试（2026-10-10）。
 *
 * 依据：`dev_docs/20261010/A2A-MCP网关进程级侧车隔离-设计方案-20261010.md` §8.1（P0）。
 * 锁定：
 *  - `trackProcess` / `untrackProcess` 登记语义；
 *  - `killOrphanedProcesses` **真正可回收**（① P0 修正：孤儿保留引用 + 两阶段终止）；
 *  - `twoPhaseKill` 的 **TDZ 修正**（SIGTERM 同步抛错不再抛 ReferenceError）。
 *
 * 用假 ChildProcess（EventEmitter + 可控 kill），**不 spawn 真实进程**。
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import {
  killOrphanedProcesses,
  trackProcess,
  untrackProcess,
  getActiveProcessCount,
  getOrphanPids,
  clearAllTracking,
} from '../../src/services/mcp/transports/ChildProcessTracker';

interface FakeProc {
  emitter: ChildProcess;
  isAlive: () => boolean;
  /** 令 kill('SIGTERM') 同步抛错（覆盖 TDZ 修正路径） */
  makeKillThrow: () => void;
}

function makeFake(pid: number, dieOnTerm = true): FakeProc {
  let alive = true;
  let throws = false;
  const emitter = new EventEmitter() as unknown as ChildProcess;
  const self = emitter as unknown as {
    pid: number;
    kill: (sig?: NodeJS.Signals | number) => boolean;
  };
  self.pid = pid;
  self.kill = (sig?: NodeJS.Signals | number): boolean => {
    if (throws) throw new Error('EINVAL');
    if (sig === 0) {
      if (!alive) throw new Error('ESRCH');
      return true;
    }
    if (sig === 'SIGTERM' && !dieOnTerm) return true; // SIGTERM 无效 ⇒ 需 SIGKILL 兜底
    alive = false;
    queueMicrotask(() => (emitter as EventEmitter).emit('exit', 0));
    return true;
  };
  return {
    emitter,
    isAlive: () => alive,
    makeKillThrow: () => {
      throws = true;
    },
  };
}

afterEach(() => clearAllTracking());

describe('① P0 MCP 子进程追踪 / 回收', () => {
  it('trackProcess ⇒ 活跃计数 +1；进程 exit ⇒ 自动移除', () => {
    const f = makeFake(1001);
    trackProcess(f.emitter, 'server-a');
    expect(getActiveProcessCount()).toBe(1);
    (f.emitter as EventEmitter).emit('exit', 0);
    expect(getActiveProcessCount()).toBe(0);
  });

  it('killOrphanedProcesses(true) ⇒ 回收活跃子进程且计数归零', async () => {
    const f = makeFake(1002);
    trackProcess(f.emitter, 'server-b');
    const r = await killOrphanedProcesses(true);
    expect(r).toEqual({ killed: 1, failed: 0 });
    expect(getActiveProcessCount()).toBe(0);
    expect(f.isAlive()).toBe(false);
  });

  it('untrackProcess 对仍存活进程 ⇒ 记入孤儿且**可被真正回收**（① P0 修正）', async () => {
    const f = makeFake(1004);
    trackProcess(f.emitter, 'server-d');
    untrackProcess(f.emitter); // kill(0) 探测存活 ⇒ 孤儿
    expect(getActiveProcessCount()).toBe(0);
    expect(getOrphanPids()).toContain(1004);

    // 旧实现：孤儿仅存 PID ⇒ activeProcesses.find 为空 ⇒ 永不回收（killed=0）。
    const r = await killOrphanedProcesses(false);
    expect(r.killed).toBe(1);
    expect(getOrphanPids()).toEqual([]);
    expect(f.isAlive()).toBe(false);
  });

  it('SIGTERM 同步抛错 ⇒ 不抛 TDZ（① P0 修正），记为 failed', async () => {
    const f = makeFake(1005);
    f.makeKillThrow();
    trackProcess(f.emitter, 'server-e');
    const r = await killOrphanedProcesses(true);
    expect(r.killed).toBe(0);
    expect(r.failed).toBe(1);
  });
});
