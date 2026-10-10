/**
 * P0-1 —— **真实进程级崩溃注入**（`.trae/specs/process-crash-injection.md`）。
 *
 * 与既有 `recoveryFaultInjection.test.ts` 的**本质区别**：后者是**进程内** `spyOn(store, m)`
 * 让方法真实提交后抛错（同一管理器继续跑）；本文件**真正 spawn 子进程**并让它
 * **SIGKILL 自身**（无 `finally`、无退出钩子、不 `close()`），再由**父进程重开库**恢复
 * —— 这才覆盖"进程在写入点之间消失"的真实时序。
 *
 * 五组场景（对应外部审查 B/C 核心）：
 *  ① 写前崩溃 ⇒ 不得把未执行工具误判为已完成；
 *  ② 记录已写/副作用未发生 ⇒ 工具调用收敛为 `unknown`（可安全判定）；
 *  ③ `unknown` 的**非幂等**工具 ⇒ **禁止自动重放**（P0-4 策略）；
 *  ④ 双执行者：迟到者不得提交有效结果（generation fencing，且跨**真实崩溃**）；
 *  ⑤ `CANCEL_REQUESTED` ≠ 底层进程已退出 ⇒ 崩溃后仍须按孤儿收敛。
 *
 * 不变量：终态不被迟到旧操作覆盖 · 未知副作用不伪装成败 · 恢复可重复执行。
 */
import { describe, it, expect, afterAll } from 'bun:test';
import { join } from 'path';
import { tmpdir } from 'os';
import { existsSync, unlinkSync } from 'fs';
import { spawnSync } from 'child_process';

import { ExecutionManager } from '../../src/execution/ExecutionManager.js';
import { ExecutionStore } from '../../src/execution/ExecutionStore.js';
import type {
  ExecutionGeneration,
  ExecutionId,
} from '../../src/execution/types.js';
import { resolveToolRecoveryPolicy } from '../../src/tools/toolEffects.js';

const CHILD = join(
  process.cwd(),
  'tests/execution/fixtures/executionCrashChild.ts'
);

let seq = 0;
const opened: Array<{ store: ExecutionStore; dbPath: string }> = [];

function makeDbPath(): string {
  return join(tmpdir(), `liri-crash-inject-${Date.now()}-${seq++}.db`);
}

function openStore(dbPath: string): ExecutionStore {
  const store = new ExecutionStore(dbPath);
  opened.push({ store, dbPath });
  return store;
}

/** 运行子进程夹具：seed 后 **SIGKILL 自身**；返回其退出状态 */
function runCrashChild(
  dbPath: string,
  scenario: string
): { status: number | null; signal: string | null; stdout: string } {
  const r = spawnSync(process.execPath, [CHILD, dbPath, scenario], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  return {
    status: r.status,
    signal: r.signal,
    stdout: `${r.stdout ?? ''}${r.stderr ?? ''}`,
  };
}

afterAll(() => {
  for (const { store, dbPath } of opened) {
    store.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const p = `${dbPath}${suffix}`;
      if (existsSync(p)) {
        try {
          unlinkSync(p);
        } catch {
          // @ignore-catch — 测试清理：Windows 下可能仍被占用
        }
      }
    }
  }
});

const eid = (s: string): ExecutionId => s as ExecutionId;
const gen = (n: number): ExecutionGeneration => n as ExecutionGeneration;

describe('P0-1 进程级崩溃注入 · 前置保障', () => {
  it('子进程抵达崩溃点（打印 SEEDED）且数据已落盘；未走"未知场景"错误路径', () => {
    const dbPath = makeDbPath();
    const r = runCrashChild(dbPath, 'after-ledger-write');
    // 抵达崩溃点（seed 已完成）——这是"真实崩溃"的**可移植**证据：
    // SIGKILL 无 `finally`/无退出钩子 ⇒ 事后仅剩落盘数据（exit code 跨平台不一致，
    // Windows 下不暴露 signal ⇒ 不断言具体退出码，只排除夹具自身的错误码 2）。
    expect(r.stdout).toContain('SEEDED');
    expect(r.status).not.toBe(2);
    expect(existsSync(dbPath)).toBe(true);
  });
});

describe('P0-1 ① 写前崩溃 ⇒ 不误判完成', () => {
  it('工具调用未落盘 ⇒ 恢复后执行 STALE（非 COMPLETED）、无 unknown 调用', async () => {
    const dbPath = makeDbPath();
    runCrashChild(dbPath, 'before-ledger-write');

    const store = openStore(dbPath);
    const m = new ExecutionManager();
    m.attachStore(store);
    const report = await m.recover({ staleMs: 90_000 });

    expect(report.recovered).toBe(1);
    expect(report.unknownToolCalls).toEqual([]);
    const row = await store.getExecution(eid('c-before'));
    expect(row?.status).toBe('STALE');
    expect(row?.generation).toBe(2);
    // 关键：**绝不**被判为已完成
    expect(row?.status).not.toBe('COMPLETED');
  });
});

describe('P0-1 ②③ 记录已写 ⇒ unknown，且非幂等工具禁止自动重放', () => {
  it('工具调用收敛为 unknown（既非成功也非失败），非幂等 ⇒ manual（不自动重放）', async () => {
    const dbPath = makeDbPath();
    runCrashChild(dbPath, 'after-ledger-write');

    const store = openStore(dbPath);
    const m = new ExecutionManager();
    m.attachStore(store);
    const report = await m.recover({ staleMs: 90_000 });

    // ② 收敛：孤儿 STALE + 工具 unknown（不永久停在 running）
    expect(report.recovered).toBe(1);
    expect(report.unknownToolCalls).toEqual([
      {
        executionId: eid('c-after'),
        sessionId: 's-after',
        toolName: 'file_write',
      },
    ]);
    const calls = await store.listToolCalls(eid('c-after'));
    expect(calls[0]?.status).toBe('unknown');
    expect(calls[0]?.endedAt).toBeDefined();

    // ③ 策略：非幂等工具 ⇒ 禁止自动重放（P0-4）
    expect(resolveToolRecoveryPolicy('file_write')).toBe('manual');
  });
});

describe('P0-1 ④ 双执行者：迟到者不得提交有效结果（跨真实崩溃的 fencing）', () => {
  it('恢复后新执行取得所有权，旧执行（代次 7）迟到提交被拒', async () => {
    const dbPath = makeDbPath();
    runCrashChild(dbPath, 'orphan-for-fencing');

    const store = openStore(dbPath);
    const m = new ExecutionManager();
    m.attachStore(store);
    await m.recover({ staleMs: 90_000 });

    // 新执行取得所有权，代次严格大于孤儿（7 → 恢复抬到 8 ⇒ 新执行 9）
    const lease = m.acquire('s-fence', 'm-new');
    expect(m.get(lease.executionId)?.status).toBe('RUNNING');
    expect(lease.generation).toBeGreaterThan(gen(8));

    // 旧执行（已被判 STALE）迟到提交 ⇒ 抛错，**不得**改写新执行状态
    expect(() => m.complete(eid('c-fence'))).toThrow();
    expect(m.get(lease.executionId)?.status).toBe('RUNNING');
    const oldRow = await store.getExecution(eid('c-fence'));
    expect(oldRow?.status).toBe('STALE');
  });
});

describe('P0-1 ⑤ CANCEL_REQUESTED ≠ 底层进程已退出', () => {
  it('取消在途但进程已崩溃 ⇒ 仍按孤儿收敛（STALE + 工具 unknown），不静默当"已取消"', async () => {
    const dbPath = makeDbPath();
    runCrashChild(dbPath, 'cancel-requested');

    const store = openStore(dbPath);
    const m = new ExecutionManager();
    m.attachStore(store);
    const report = await m.recover({ staleMs: 90_000 });

    expect(report.recovered).toBe(1);
    expect(report.unknownToolCalls).toEqual([
      { executionId: eid('c-cancel'), sessionId: 's-cancel', toolName: 'bash' },
    ]);
    const row = await store.getExecution(eid('c-cancel'));
    // 关键：不是 CANCELLED（取消请求 ≠ 进程已退出），而是按孤儿 STALE 收敛
    expect(row?.status).toBe('STALE');
    expect(row?.generation).toBe(4);
  });
});

describe('P0-1 不变量：恢复可重复执行', () => {
  it('第二次 recover 幂等（不再回收、不重复抬升代次）', async () => {
    const dbPath = makeDbPath();
    runCrashChild(dbPath, 'after-ledger-write');

    const store = openStore(dbPath);
    const m = new ExecutionManager();
    m.attachStore(store);
    const first = await m.recover({ staleMs: 90_000 });
    const second = await m.recover({ staleMs: 90_000 });

    expect(first.recovered).toBe(1);
    expect(second).toEqual({
      recovered: 0,
      kept: 0,
      unknownToolCalls: [],
    });
    const row = await store.getExecution(eid('c-after'));
    expect(row?.generation).toBe(3); // 只抬升一次
  });
});
