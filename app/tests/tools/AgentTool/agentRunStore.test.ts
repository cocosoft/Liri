/**
 * AgentRunStore 运行态持久化测试（多 agent 协作方案 O6，B4）
 *
 * 锁定六要素中的可测部分：
 * ① `tool_call_id` 主键幂等 upsert；② 陈旧自愈（非本进程所有 + pid 不存在 ⇒ `unknown`）；
 * ③ `schema_version` + 幂等 DDL + 补列；⑤ 保留裁剪；⑥ 批次逐任务各自落盘。
 * 另：连接可释放（不泄漏）。
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync } from 'fs';
import { Database } from '@modules/core/external/sqlite3';
import {
  AgentRunStore,
  AGENT_RUNS_TABLE,
  AGENT_RUNS_SCHEMA_VERSION,
  RETENTION_TERMINAL_MAX,
  PROCESS_START_TOLERANCE_MS,
  currentOwnerIdentity,
  readProcessStartTime,
} from '../../../src/tools/AgentTool/AgentRunStore';

const createdPaths: string[] = [];
const openedStores: AgentRunStore[] = [];

function makeDbPath(): string {
  const path = join(tmpdir(), `agent-runs-${randomUUID().slice(0, 8)}.db`);
  createdPaths.push(path);
  return path;
}

async function makeStore(): Promise<AgentRunStore> {
  const store = new AgentRunStore(makeDbPath());
  openedStores.push(store);
  await store.init();
  return store;
}

afterEach(() => {
  while (openedStores.length > 0) openedStores.pop()!.close();
  while (createdPaths.length > 0) {
    try {
      unlinkSync(createdPaths.pop()!);
    } catch {
      // @ignore-catch — 清理临时文件失败不影响断言
    }
  }
});

/** 旧结构库（缺 batch_id、task_key、owner 两列、delivery 两列） */
async function createLegacyDb(path: string): Promise<void> {
  const db = await new Promise<Database>((resolve, reject) => {
    const opened = new Database(path, (err: Error | null) =>
      err ? reject(err) : resolve(opened)
    );
  });
  await new Promise<void>((resolve, reject) => {
    db.run(
      `CREATE TABLE ${AGENT_RUNS_TABLE} (
        tool_call_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        session_id TEXT,
        name TEXT NOT NULL,
        agent_type TEXT NOT NULL,
        status TEXT NOT NULL,
        output_summary TEXT,
        error TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER
      )`,
      (err: Error | null) => (err ? reject(err) : resolve())
    );
  });
  db.close();
}

describe('AgentRunStore：DDL / schema_version（③）', () => {
  test('init 幂等：重复初始化不抛错，schema_version 落库', async () => {
    const path = makeDbPath();
    const first = new AgentRunStore(path);
    openedStores.push(first);
    await first.init();
    const second = new AgentRunStore(path);
    openedStores.push(second);
    await second.init().catch((err) => {
      throw new Error(`重复 init 不应抛错：${String(err)}`);
    });

    const db = await new Promise<Database>((resolve, reject) => {
      const opened = new Database(path, (err: Error | null) =>
        err ? reject(err) : resolve(opened)
      );
    });
    const version = await new Promise<string | undefined>((resolve, reject) => {
      db.get(
        `SELECT value FROM agent_runs_meta WHERE key = 'schema_version'`,
        (err: Error | null, row: { value: string } | undefined) =>
          err ? reject(err) : resolve(row?.value)
      );
    });
    db.close();
    expect(Number(version)).toBe(AGENT_RUNS_SCHEMA_VERSION);
  });

  test('老库（缺列）⇒ 幂等补列后可正常读写', async () => {
    const path = makeDbPath();
    await createLegacyDb(path);
    const store = new AgentRunStore(path);
    openedStores.push(store);
    await store.init();

    await store.startRun({
      toolCallId: 'tc-legacy',
      agentId: 'a1',
      name: 'A',
      agentType: 'general',
      status: 'running',
      batchId: 'batch-1',
      taskKey: 'w1',
    });
    const row = await store.getRun('tc-legacy');
    expect(row?.batchId).toBe('batch-1');
    expect(row?.taskKey).toBe('w1');
    expect(row?.deliveryState).toBe('pending'); // ④ 预留列（O8 消费）
  });
});

describe('AgentRunStore：陈旧自愈（②）', () => {
  test('非本进程所有 + owner pid 不存在 ⇒ 判 `unknown`（不是 error）', async () => {
    const store = await makeStore();
    // owner_pid=0 必不存在（isPidAlive 对 <=0 直接判死）
    await store.startRun({
      toolCallId: 'tc-stale',
      agentId: 'a-stale',
      name: 'stale',
      agentType: 'general',
      status: 'running',
      ownerPid: 0,
      ownerStartedAt: 1,
    });

    const healed = await store.markStaleRunsUnknown();
    expect(healed).toBe(1);

    const row = await store.getRun('tc-stale');
    expect(row?.status).toBe('unknown');
    expect(row?.endedAt).toBeGreaterThan(0);
  });

  test('本进程所有且仍在途 ⇒ **不**判 unknown（保守不误杀）', async () => {
    const store = await makeStore();
    const me = currentOwnerIdentity();
    await store.startRun({
      toolCallId: 'tc-mine',
      agentId: 'a-mine',
      name: 'mine',
      agentType: 'general',
      status: 'running',
      ownerPid: me.pid,
      ownerStartedAt: me.startedAt,
    });

    expect(await store.markStaleRunsUnknown()).toBe(0);
    expect((await store.getRun('tc-mine'))?.status).toBe('running');
  });
});

describe('AgentRunStore：保留裁剪（⑤）', () => {
  test('终态只保留最近 N 条（超出裁剪最旧）', async () => {
    const store = await makeStore();
    const total = RETENTION_TERMINAL_MAX + 5;
    // 基准取"当前时间 - total"，保证全部落在 7 天保留窗内（否则先被时长规则删除）
    const base = Date.now() - total;
    for (let i = 0; i < total; i++) {
      const id = `tc-${String(i).padStart(3, '0')}`;
      await store.startRun({
        toolCallId: id,
        agentId: id,
        name: id,
        agentType: 'general',
        status: 'running',
        startedAt: base + i, // 递增，避免同毫秒导致排序不确定
      });
      await store.settleRun(id, 'completed', { endedAt: base + i });
    }

    const pruned = await store.prune();
    const remaining = await store.listRuns('completed');
    expect(remaining).toHaveLength(RETENTION_TERMINAL_MAX);
    expect(pruned).toBe(total - RETENTION_TERMINAL_MAX);
    // 最旧的被裁掉、最新的保留
    expect(await store.getRun('tc-000')).toBeNull();
    expect(await store.getRun(`tc-${String(total - 1).padStart(3, '0')}`)).not.toBeNull();
  });
});

describe('AgentRunStore：批次逐任务落盘（⑥）', () => {
  test('同一批次的两个 worker 各自一行，分别落终态', async () => {
    const store = await makeStore();
    for (const taskKey of ['w1', 'w2']) {
      await store.startRun({
        toolCallId: `batch-1::${taskKey}`,
        agentId: 'batch-1',
        name: taskKey,
        agentType: 'general',
        status: 'running',
        batchId: 'batch-1',
        taskKey,
      });
    }
    await store.settleRun('batch-1::w1', 'completed', {
      outputSummary: 'out-a',
    });
    await store.settleRun('batch-1::w2', 'failed', { error: 'boom' });

    const w1 = await store.getRun('batch-1::w1');
    const w2 = await store.getRun('batch-1::w2');
    expect(w1?.status).toBe('completed');
    expect(w1?.outputSummary).toBe('out-a');
    expect(w1?.batchId).toBe('batch-1');
    expect(w2?.status).toBe('failed');
    expect(w2?.error).toBe('boom');
    // 批次内逐任务写回 ⇒ 一个 worker 完成不影响另一个的行
    expect(await store.listRuns('running')).toHaveLength(0);
  });

  test('主键幂等：同 `tool_call_id` 重复起跑不产生第二行', async () => {
    const store = await makeStore();
    const rec = {
      toolCallId: 'tc-dup',
      agentId: 'a1',
      name: 'A',
      agentType: 'general',
      status: 'running' as const,
    };
    await store.startRun(rec);
    await store.startRun(rec);

    expect(await store.listRuns()).toHaveLength(1);
  });
});

describe('AgentRunStore：终态幂等（O13）', () => {
  test('已完成后再被上报 failed ⇒ 磁盘保持 completed（内存/磁盘同一答案）', async () => {
    const store = await makeStore();
    await store.startRun({
      toolCallId: 'tc-terminal',
      agentId: 'a1',
      name: 'A',
      agentType: 'general',
      status: 'running',
    });

    expect(await store.settleRun('tc-terminal', 'completed')).toBe(true);
    // 收尾路径再报 failed：内存台账拒绝（终态不可改写）⇒ 磁盘必须同样拒绝
    expect(
      await store.settleRun('tc-terminal', 'failed', { error: '收尾组装抛错' })
    ).toBe(false);

    const row = await store.getRun('tc-terminal');
    expect(row?.status).toBe('completed');
    expect(row?.error ?? null).toBeNull();
  });

  test('`unknown`（陈旧自愈）非终态 ⇒ 仍可落真实结果', async () => {
    const store = await makeStore();
    await store.startRun({
      toolCallId: 'tc-heal',
      agentId: 'a2',
      name: 'B',
      agentType: 'general',
      status: 'running',
    });

    await store.settleRun('tc-heal', 'unknown');
    expect(await store.settleRun('tc-heal', 'completed')).toBe(true);
    expect((await store.getRun('tc-heal'))?.status).toBe('completed');
  });

  test('并行批次 worker 行同样受守卫（`batchId::taskKey` 主键）', async () => {
    const store = await makeStore();
    await store.startRun({
      toolCallId: 'batch-x::w1',
      agentId: 'batch-x',
      name: 'w1',
      agentType: 'general',
      status: 'running',
      batchId: 'batch-x',
      taskKey: 'w1',
    });

    await store.settleRun('batch-x::w1', 'completed');
    expect(await store.settleRun('batch-x::w1', 'failed')).toBe(false);
    expect((await store.getRun('batch-x::w1'))?.status).toBe('completed');
  });
});

describe('AgentRunStore：PID 复用判定（O6② / v7.1）', () => {
  test('readProcessStartTime：本进程可读，且与 `Date.now() - uptime()` 同源（容差内）', () => {
    const start = readProcessStartTime(process.pid);
    expect(start).not.toBeNull();

    const expected = Date.now() - Math.round(process.uptime() * 1000);
    expect(
      Math.abs((start ?? 0) - expected)
    ).toBeLessThan(PROCESS_START_TOLERANCE_MS);
  });

  test('readProcessStartTime：不存在的/非法 pid ⇒ null（调用方保持保守）', () => {
    expect(readProcessStartTime(999999999)).toBeNull();
    expect(readProcessStartTime(0)).toBeNull();
    expect(readProcessStartTime(-1)).toBeNull();
  });

  test('markStaleRunsUnknown：pid 存活但启动时间不符（PID 复用）⇒ 判 `unknown`', async () => {
    const store = await makeStore();
    const me = currentOwnerIdentity();

    // 伪造"他进程所有"的在途行：pid 取自本进程（保证 isPidAlive=true），
    // 但记录的启动时间差 1 小时 ⇒ 等同"该 pid 已被别的进程复用"
    await store.startRun({
      toolCallId: 'tc-reused',
      agentId: 'tc-reused',
      name: 'reused',
      agentType: 'general',
      status: 'running',
      ownerPid: me.pid,
      ownerStartedAt: me.startedAt - 3600_000,
    });

    const healed = await store.markStaleRunsUnknown();
    expect(healed).toBeGreaterThanOrEqual(1);
    expect((await store.getRun('tc-reused'))?.status).toBe('unknown');
  });

  test('markStaleRunsUnknown：启动时间在容差内 ⇒ 保守保留（不误回收在途 run）', async () => {
    const store = await makeStore();
    const me = currentOwnerIdentity();

    await store.startRun({
      toolCallId: 'tc-same-proc',
      agentId: 'tc-same-proc',
      name: 'same',
      agentType: 'general',
      status: 'running',
      ownerPid: me.pid,
      // 差 2s（< 5s 容差）⇒ 无法证明是复用 ⇒ 不判 unknown
      ownerStartedAt: me.startedAt - 2000,
    });

    await store.markStaleRunsUnknown();
    expect((await store.getRun('tc-same-proc'))?.status).toBe('running');
  });
});

describe('AgentRunStore：读方法冷启动（T8 端点冒烟回归）', () => {
  test('未显式 `init()` 也能读（读方法内部 await init，不依赖调用方先初始化）', async () => {
    const path = makeDbPath();
    // 故意不调用 init()：模拟"单例刚创建 + 尚无任何 run 写入"的冷启动
    const store = new AgentRunStore(path);

    // 修复前：listRuns/getRun 直读 `this.db === null` ⇒ 抛 "Database not initialized"
    // （T8 的 `GET /v1/agents/runs` 实测 500 复现）
    expect(await store.listRuns()).toEqual([]);
    expect(await store.getRun('no-such-run')).toBeNull();

    store.close();
  });
});

describe('AgentRunStore：描述符来源落盘（O19 / schema v2）', () => {
  test('setDescriptorSource 可写可读，且**不改状态**（幂等）', async () => {
    const store = await makeStore();
    await store.startRun({
      toolCallId: 'tc-src',
      agentId: 'a1',
      name: 'A',
      agentType: 'architect',
      status: 'running',
    });
    expect((await store.getRun('tc-src'))?.descriptorSource).toBeUndefined();

    await store.setDescriptorSource('tc-src', 'role-store');
    await store.setDescriptorSource('tc-src', 'role-store');

    const row = await store.getRun('tc-src');
    expect(row?.descriptorSource).toBe('role-store');
    expect(row?.status).toBe('running'); // 只写来源，不动状态机
  });

  test('`startRun` 可携带来源；重复起跑缺省时**不抹掉**已有值', async () => {
    const store = await makeStore();
    const base = {
      toolCallId: 'tc-src2',
      agentId: 'a2',
      name: 'B',
      agentType: 'general',
      status: 'running' as const,
    };
    await store.startRun({ ...base, descriptorSource: 'builtin' });
    expect((await store.getRun('tc-src2'))?.descriptorSource).toBe('builtin');

    await store.startRun(base);
    expect((await store.getRun('tc-src2'))?.descriptorSource).toBe('builtin');
  });

  test('老库（无 `descriptor_source` 列）⇒ 幂等补列后可写可读', async () => {
    const path = makeDbPath();
    await createLegacyDb(path);

    const store = new AgentRunStore(path);
    await store.init();
    await store.startRun({
      toolCallId: 'tc-legacy-src',
      agentId: 'a3',
      name: 'C',
      agentType: 'general',
      status: 'running',
    });
    await store.setDescriptorSource('tc-legacy-src', 'registry');

    expect((await store.getRun('tc-legacy-src'))?.descriptorSource).toBe(
      'registry'
    );
    store.close();
  });
});
