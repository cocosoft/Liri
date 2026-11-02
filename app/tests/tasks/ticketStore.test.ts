/**
 * P34 · 工作项语义列 + 派工记录（持久化）测试
 *
 * 覆盖方案 §5 P34 的验收口径：
 * ① 工作项的语义列（来源/归属/目录/授权/产物）可写可读，并与 `data` 合并成同一视图；
 * ② 存量调用点（只写 id/status）零改动：缺字段写 NULL，读回不报错；
 * ③ 一个工作项可有多个 Assignment，`latest` 取最后一条；
 * ④ 进程重启（关闭连接后重开）数据仍在；建表/补列可重入。
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from '@openliri/infra/external';

import {
  closePdcaCheckpointStore,
  listPdcaWorkItems,
  writePdcaWorkItem,
} from '../../src/tasks/PdcaWorkItemBridge';
import {
  closeTicketAssignmentStore,
  findWorkItemIdBySession,
  latestTicketAssignment,
  listTicketAssignments,
  listTicketAssignmentsBySession,
  upsertTicketAssignment,
  type TicketAssignmentRecord,
} from '../../src/tasks/ticketAssignmentStore';

let dataDir: string;
let prevDataDir: string | undefined;

function assignment(
  over: Partial<TicketAssignmentRecord>
): TicketAssignmentRecord {
  return {
    assignmentId: 'a-1',
    workItemId: 'w-1',
    executor: 'alwayson',
    state: 'pending',
    startedAt: 1000,
    updatedAt: 1000,
    ...over,
  };
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'p34-ticket-'));
  prevDataDir = process.env.LIRI_DATA_DIR;
  process.env.LIRI_DATA_DIR = dataDir;
  // 单例按 DB 路径键控：先释放，确保新目录生效
  closePdcaCheckpointStore();
  closeTicketAssignmentStore();
});

afterEach(() => {
  closePdcaCheckpointStore();
  closeTicketAssignmentStore();
  if (prevDataDir === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = prevDataDir;
  try {
    rmSync(dataDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {
    /* Windows 下句柄可能未即时释放；清理失败不影响测试结论 */
  }
});

describe('P34 · 工作项语义列', () => {
  it('写入后可按语义列读回（来源/归属/目录/授权/产物）', async () => {
    await writePdcaWorkItem({
      id: 'w-1',
      status: 'running',
      updatedAt: new Date(1700000000000).toISOString(),
      sourceId: 'cron',
      origin: { channel: 'cli', threadId: 'th-1' },
      workspaceDir: '/tmp/ws-1',
      sessionId: 's-1',
      policyId: 'ps1-abc',
      parentId: 'w-0',
      artifacts: ['out/a.md'],
      mandate: { strength: 'explicit', basis: { via: 'addressed' } },
      goal: '整理周报',
    });

    const rows = await listPdcaWorkItems();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.id).toBe('w-1');
    expect(row.status).toBe('running');
    expect(row.sourceId).toBe('cron');
    expect(row.origin).toEqual({ channel: 'cli', threadId: 'th-1' });
    expect(row.workspaceDir).toBe('/tmp/ws-1');
    expect(row.sessionId).toBe('s-1');
    expect(row.policyId).toBe('ps1-abc');
    expect(row.parentId).toBe('w-0');
    expect(row.artifacts).toEqual(['out/a.md']);
    expect(row.mandate).toEqual({
      strength: 'explicit',
      basis: { via: 'addressed' },
    });
    // data 里的旧字段仍可见（data 仍是事实源）
    expect(row.goal).toBe('整理周报');
  });

  it('存量调用点（只写 id/status）不报错；缺失列不臆造', async () => {
    await writePdcaWorkItem({ id: 'legacy-1', status: 'completed' });
    const rows = await listPdcaWorkItems('completed');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('legacy-1');
    expect(rows[0]!.sourceId).toBeUndefined();
    expect(rows[0]!.artifacts).toBeUndefined();
  });

  it('status 过滤生效（undefined = 全部）', async () => {
    await writePdcaWorkItem({ id: 'w-a', status: 'running' });
    await writePdcaWorkItem({ id: 'w-b', status: 'completed' });
    expect(await listPdcaWorkItems('running')).toHaveLength(1);
    expect(await listPdcaWorkItems()).toHaveLength(2);
  });
});

describe('P34 · 派工（Assignment）记录', () => {
  it('同一工作项可有多个派工，latest 取最后一条', async () => {
    await upsertTicketAssignment(
      assignment({ assignmentId: 'a-1', state: 'pending' })
    );
    await upsertTicketAssignment(
      assignment({
        assignmentId: 'a-2',
        state: 'running',
        startedAt: 2000,
        updatedAt: 2000,
      })
    );
    await upsertTicketAssignment(
      assignment({
        assignmentId: 'a-3',
        state: 'ended',
        startedAt: 3000,
        updatedAt: 4000,
        endedAt: 4000,
        reportState: 'ready',
      })
    );

    const list = await listTicketAssignments('w-1');
    expect(list.map((a) => a.assignmentId)).toEqual(['a-1', 'a-2', 'a-3']);

    const latest = await latestTicketAssignment('w-1');
    expect(latest?.assignmentId).toBe('a-3');
    expect(latest?.state).toBe('ended');
    expect(latest?.reportState).toBe('ready');
  });

  it('同 id 重写即更新（状态推进与报告回填）', async () => {
    await upsertTicketAssignment(
      assignment({ assignmentId: 'a-1', state: 'running' })
    );
    await upsertTicketAssignment(
      assignment({
        assignmentId: 'a-1',
        state: 'running',
        reportState: 'blocked',
        reportText: '缺少目标仓库',
        updatedAt: 2000,
      })
    );
    const list = await listTicketAssignments('w-1');
    expect(list).toHaveLength(1);
    expect(list[0]!.reportState).toBe('blocked');
    expect(list[0]!.reportText).toBe('缺少目标仓库');
  });

  it('从未派工 ⇒ latest 为 undefined', async () => {
    expect(await latestTicketAssignment('nobody')).toBeUndefined();
  });

  it('按会话反查工作项（产物归属链的最后一跳）', async () => {
    await upsertTicketAssignment(
      assignment({ assignmentId: 'a-1', workItemId: 'w-1', sessionId: 's-1' })
    );
    await upsertTicketAssignment(
      assignment({
        assignmentId: 'a-2',
        workItemId: 'w-2',
        sessionId: 's-1',
        startedAt: 2000,
        updatedAt: 2000,
      })
    );

    const bySession = await listTicketAssignmentsBySession('s-1');
    expect(bySession.map((a) => a.workItemId)).toEqual(['w-1', 'w-2']);
    // 最近一次派工所属工作项
    expect(await findWorkItemIdBySession('s-1')).toBe('w-2');
    // 无记录 ⇒ undefined（不猜）
    expect(await findWorkItemIdBySession('s-none')).toBeUndefined();
  });

  it('重写时不带 sessionId 也不会抹掉已记录的会话（COALESCE）', async () => {
    await upsertTicketAssignment(
      assignment({ assignmentId: 'a-1', state: 'running', sessionId: 's-9' })
    );
    await upsertTicketAssignment(
      assignment({
        assignmentId: 'a-1',
        state: 'ended',
        reportState: 'ready',
        updatedAt: 2000,
        endedAt: 2000,
      })
    );
    expect((await latestTicketAssignment('w-1'))?.sessionId).toBe('s-9');
  });
});

describe('P34 · 重启恢复与建表幂等', () => {
  it('存量库缺 session_id 列 ⇒ 自动补列且索引后建（不因缺列失败）', async () => {
    // 用旧版 DDL 预建表（无 session_id）
    const db = await new Promise<Database>((resolve, reject) => {
      const d = new Database(join(dataDir, 'app.db'), (err) => {
        if (err) reject(err);
        else resolve(d);
      });
    });
    await new Promise<void>((resolve, reject) => {
      db.run(
        `CREATE TABLE ticket_assignments (
           assignment_id TEXT PRIMARY KEY,
           work_item_id  TEXT NOT NULL,
           executor      TEXT NOT NULL DEFAULT '',
           state         TEXT NOT NULL DEFAULT 'pending',
           report_state  TEXT,
           report_text   TEXT,
           started_at    INTEGER NOT NULL,
           ended_at      INTEGER,
           updated_at    INTEGER NOT NULL
         )`,
        (err) => (err ? reject(err) : resolve())
      );
    });
    await new Promise<void>((resolve, reject) => {
      db.run(
        `INSERT INTO ticket_assignments
           (assignment_id, work_item_id, executor, state, started_at, updated_at)
         VALUES ('legacy-a', 'legacy-w', 'alwayson', 'ended', 1, 1)`,
        (err) => (err ? reject(err) : resolve())
      );
    });
    db.close(() => {});

    // 初始化应自动补列（并在补列之后建 session 索引），旧行可读
    const latest = await latestTicketAssignment('legacy-w');
    expect(latest?.assignmentId).toBe('legacy-a');
    expect(latest?.sessionId).toBeUndefined();

    // 补列后新写入的会话可被反查
    await upsertTicketAssignment(
      assignment({
        assignmentId: 'a-new',
        workItemId: 'legacy-w',
        sessionId: 's-new',
        startedAt: 2,
        updatedAt: 2,
      })
    );
    expect(await findWorkItemIdBySession('s-new')).toBe('legacy-w');
  });

  it('关闭连接后重开，工作项与派工都还在（建表/补列可重入）', async () => {
    await writePdcaWorkItem({
      id: 'w-restart',
      status: 'running',
      sourceId: 'fs',
      artifacts: ['a.txt'],
    });
    await upsertTicketAssignment(
      assignment({
        assignmentId: 'a-r',
        workItemId: 'w-restart',
        state: 'running',
      })
    );

    // 模拟进程重启
    closePdcaCheckpointStore();
    closeTicketAssignmentStore();

    const rows = await listPdcaWorkItems();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('w-restart');
    expect(rows[0]!.sourceId).toBe('fs');
    expect((await latestTicketAssignment('w-restart'))?.state).toBe('running');
  });
});
