/**
 * REPL 进程生命周期（2026-11-27）
 *
 * 两件事：
 *  1. **可观测性**：REPL 子进程登记进 `ProcessRegistry`（此前完全不在
 *     `/v1/sandbox/status` 的 `processStats` 里），终态按 `killed` / `timed_out` /
 *     `completed` / `error` 收敛，且收敛幂等；
 *  2. **回收语义**：`collectExpiredSessions` 只查询、不删；回收统一走
 *     `reclaimIdleSessions`（查询 → `stopREPL`：kill + 收终态 + 释放 Windows 会话授权），
 *     不再出现"只删登记、进程还活着"的旧实现。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  completeReplProcess,
  registerReplProcess,
  REPLToolImpl,
} from '@openliri/tool-code/repl/REPLToolImpl';
import { replSessionManager } from '@openliri/tool-code/repl/REPLSessionManager';
import { REPLSessionStatus } from '@openliri/tool-code/repl/types/REPLTool';
import type { ReplSandboxPlan } from '@openliri/tool-code/repl/replSandboxSpawn';
import { PROCESS_STATUS, processRegistry } from '@modules/sandbox';

const PLAN: ReplSandboxPlan = {
  command: 'python',
  args: ['-i'],
  env: {},
  mode: 'none',
  reason: 'test',
};

/** 假子进程：只提供 `pid` / `kill` / 事件能力（不真起进程） */
function fakeChild(pid?: number): ChildProcess {
  const emitter = new EventEmitter() as unknown as ChildProcess;
  Object.defineProperty(emitter, 'pid', { value: pid, configurable: true });
  (emitter as unknown as { kill: () => boolean }).kill = () => true;
  return emitter;
}

function cleanupSession(id: string): void {
  replSessionManager.removeSession(id);
}

beforeEach(() => {
  replSessionManager.clearSessions();
});

afterEach(() => {
  replSessionManager.clearSessions();
});

describe('ProcessRegistry：REPL 子进程登记与终态收敛', () => {
  it('登记为 running（metadata 带 source/language/mode），自然退出 ⇒ completed', () => {
    const session = replSessionManager.createSession('python');
    const child = fakeChild(4242);
    registerReplProcess(session, child, PLAN);

    const id = session.processEntryId;
    expect(id).toBeDefined();
    const entry = processRegistry.getProcess(id!);
    expect(entry?.status).toBe(PROCESS_STATUS.running);
    expect(entry?.pid).toBe(4242);
    expect(entry?.command).toBe('repl:python');
    expect(entry?.metadata).toMatchObject({
      source: 'repl',
      language: 'python',
      mode: 'none',
    });

    child.emit('exit', 0);
    expect(processRegistry.getProcess(id!)?.status).toBe(
      PROCESS_STATUS.completed
    );
    expect(processRegistry.getProcess(id!)?.exitCode).toBe(0);
    // 幂等：终态后 id 清空，后续事件 no-op
    expect(session.processEntryId).toBeUndefined();

    processRegistry.removeProcess(id!);
    cleanupSession(session.id);
  });

  it('spawn 失败（error 事件）⇒ error', () => {
    const session = replSessionManager.createSession('node');
    const child = fakeChild(4243);
    registerReplProcess(session, child, { ...PLAN, mode: 'landlock' });
    const id = session.processEntryId!;

    child.emit('error', new Error('spawn ENOENT'));
    expect(processRegistry.getProcess(id)?.status).toBe(PROCESS_STATUS.error);

    processRegistry.removeProcess(id);
    cleanupSession(session.id);
  });

  it('无 pid（未取到句柄）⇒ 不登记，不制造空条目', () => {
    const session = replSessionManager.createSession('node');
    registerReplProcess(session, fakeChild(undefined), PLAN);
    expect(session.processEntryId).toBeUndefined();
    cleanupSession(session.id);
  });

  it('收敛幂等：重复 complete 不会改写已收敛的状态', () => {
    const session = replSessionManager.createSession('python');
    const child = fakeChild(4244);
    registerReplProcess(session, child, PLAN);
    const id = session.processEntryId!;

    completeReplProcess(session, PROCESS_STATUS.killed);
    completeReplProcess(session, PROCESS_STATUS.completed, 0);
    expect(processRegistry.getProcess(id)?.status).toBe(PROCESS_STATUS.killed);

    processRegistry.removeProcess(id);
    cleanupSession(session.id);
  });

  it('stopREPL ⇒ killed（主动停止不冒充 completed）', async () => {
    const tool = new REPLToolImpl();
    const session = replSessionManager.createSession('python');
    const child = fakeChild(4245);
    session.process = child;
    registerReplProcess(session, child, PLAN);
    const id = session.processEntryId!;

    await tool.stopREPL(session);
    expect(processRegistry.getProcess(id)?.status).toBe(PROCESS_STATUS.killed);
    expect(session.status).toBe(REPLSessionStatus.STOPPED);

    processRegistry.removeProcess(id);
  });

  it('真实 spawn（javascript）⇒ 登记 running，stop 后 killed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'repl-proc-'));
    const tool = new REPLToolImpl();
    const session = await tool.startREPL('javascript', {
      cwd: dir,
      timeout: 5_000,
    });
    const id = session.processEntryId;
    try {
      expect(id).toBeDefined();
      expect(processRegistry.getProcess(id!)?.status).toBe(
        PROCESS_STATUS.running
      );
    } finally {
      await tool.stopREPL(session);
      if (id) {
        expect(processRegistry.getProcess(id)?.status).toBe(
          PROCESS_STATUS.killed
        );
        processRegistry.removeProcess(id);
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('会话回收：查询与 kill 分离', () => {
  it('collectExpiredSessions 只查询，不删除、不改状态', () => {
    const fresh = replSessionManager.createSession('python');
    const stale = replSessionManager.createSession('python');
    (stale as unknown as { lastActivity: Date }).lastActivity = new Date(
      Date.now() - 11 * 60 * 1000
    );

    const expired = replSessionManager.collectExpiredSessions(10 * 60 * 1000);
    expect(expired.map((s) => s.id)).toEqual([stale.id]);
    // 纯查询：两个会话都还在
    expect(replSessionManager.getSessionCount()).toBe(2);
    expect(replSessionManager.getSession(fresh.id)).toBeDefined();
    expect(replSessionManager.getSession(stale.id)).toBeDefined();
  });

  it('reclaimIdleSessions ⇒ 逐个 stopREPL（移除 + 收敛终态），返回回收数', async () => {
    const tool = new REPLToolImpl();
    const staleA = replSessionManager.createSession('python');
    const staleB = replSessionManager.createSession('node');
    const pids = [5101, 5102];
    [staleA, staleB].forEach((s, index) => {
      (s as unknown as { lastActivity: Date }).lastActivity = new Date(
        Date.now() - 11 * 60 * 1000
      );
      s.process = fakeChild(pids[index]);
      registerReplProcess(s, s.process, PLAN);
    });
    const fresh = replSessionManager.createSession('node');

    const count = await tool.reclaimIdleSessions(10 * 60 * 1000);

    expect(count).toBe(2);
    expect(replSessionManager.getSession(staleA.id)).toBeUndefined();
    expect(replSessionManager.getSession(staleB.id)).toBeUndefined();
    expect(replSessionManager.getSession(fresh.id)).toBeDefined();
    cleanupSession(fresh.id);
  });
});
