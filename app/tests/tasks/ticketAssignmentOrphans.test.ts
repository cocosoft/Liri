/**
 * P36-b · 启动期孤儿派工收尾（2026-11-02）
 *
 * 覆盖方案 §7「重启恢复」：
 * ① 上一进程遗留的 `running` 派工 ⇒ 启动收尾为 `ended` + `reportState='dropped'`；
 * ② 收尾后 ownership 读侧返回 `none`（消息被 `accept`，不会被永久排队）；
 * ③ 幂等（再收一次返回 0）；`pending` 行不受影响（它不构成"持有"）；
 * ④ `ended_at` 只在缺省时写入（不覆盖既有结束时刻）。
 *
 * 用临时 `LIRI_DATA_DIR` 建真库：这条判据依赖 SQL 语义（`WHERE state='running'`），
 * 内存假实现无法证明。
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  closeOrphanRunningAssignments,
  closeTicketAssignmentStore,
  listTicketAssignmentsBySession,
  upsertTicketAssignment,
} from '../../src/tasks/ticketAssignmentStore';
import { resolveSessionOwner } from '../../src/chat/ownership/resolveSessionOwner';

const ROOT = mkdtempSync(join(tmpdir(), 'p36-orphans-'));
const PREVIOUS_DATA_DIR = process.env.LIRI_DATA_DIR;

beforeAll(() => {
  process.env.LIRI_DATA_DIR = ROOT;
  closeTicketAssignmentStore();
});

afterAll(async () => {
  closeTicketAssignmentStore();
  if (PREVIOUS_DATA_DIR === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = PREVIOUS_DATA_DIR;
  // Windows 上 sqlite 句柄释放是异步回调 ⇒ 等一拍再删（否则偶发 EBUSY）
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(ROOT, { recursive: true, force: true });
});

describe('P36-b: closeOrphanRunningAssignments', () => {
  it('running ⇒ ended/dropped，读侧随即 none；幂等且不动 pending', async () => {
    await upsertTicketAssignment({
      assignmentId: 'a-crashed',
      workItemId: 'w-1',
      executor: 'alwayson',
      state: 'running',
      sessionId: 's-crashed',
      startedAt: 1,
      updatedAt: 1,
    });
    await upsertTicketAssignment({
      assignmentId: 'a-pending',
      workItemId: 'w-2',
      executor: 'alwayson',
      state: 'pending',
      sessionId: 's-pending',
      startedAt: 1,
      updatedAt: 1,
    });

    // 崩溃前：读侧认为会话被自主持有
    const before = await resolveSessionOwner('s-crashed', (sid) =>
      listTicketAssignmentsBySession(sid)
    );
    expect(before.kind).toBe('autonomous');

    const closed = await closeOrphanRunningAssignments(1_000);
    expect(closed).toBe(1);

    const rows = await listTicketAssignmentsBySession('s-crashed');
    expect(rows[0]).toMatchObject({
      assignmentId: 'a-crashed',
      state: 'ended',
      reportState: 'dropped',
      endedAt: 1_000,
    });

    // 收尾后：消息可以 accept（不会永久排队）
    const after = await resolveSessionOwner('s-crashed', (sid) =>
      listTicketAssignmentsBySession(sid)
    );
    expect(after).toEqual({ kind: 'none' });

    // 幂等：再收一次 0 行
    expect(await closeOrphanRunningAssignments(2_000)).toBe(0);

    // pending 不构成持有 ⇒ 不收尾（也不被误改成 ended）
    const pending = await listTicketAssignmentsBySession('s-pending');
    expect(pending[0].state).toBe('pending');
    expect(pending[0].reportState).toBeUndefined();
  });

  it('已有 ended_at ⇒ 不覆盖（只补缺省）', async () => {
    await upsertTicketAssignment({
      assignmentId: 'a-legacy',
      workItemId: 'w-3',
      executor: 'alwayson',
      state: 'running',
      sessionId: 's-legacy',
      startedAt: 1,
      endedAt: 777,
      updatedAt: 1,
    });

    expect(await closeOrphanRunningAssignments(9_999)).toBe(1);
    const rows = await listTicketAssignmentsBySession('s-legacy');
    expect(rows[0]).toMatchObject({ state: 'ended', endedAt: 777 });
  });
});
