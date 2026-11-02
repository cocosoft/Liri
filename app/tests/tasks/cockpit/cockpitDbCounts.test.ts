/**
 * P39 · 面板数字 = DB 计数（DB 侧断言，2026-11-02）
 *
 * 用临时 `LIRI_DATA_DIR` 建**真库**（`workitems` + `ticket_assignments`），验证：
 * ① `metrics.total` = 可勾稽的工作项行数（SQL 计数，而非测试里的数组长度）；
 * ② `metrics.endedCount` = 终态 status 的 SQL 计数；
 * ③ 分组长度之和 = 项总数（`checkCockpitInvariants` 自洽）。
 *
 * 为什么必须打真库：前端/单测里的数字都来自构造的数组，"数字 = 列表长度"是同义反复；
 * 只有把 DB 当事实源，才能证明面板没有多算/少算行（`docs/005:56` 诚实状态）。
 */
import { afterAll, beforeAll, describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveDbPath } from '@openliri/infra/environment';

import {
  PDCA_TERMINAL_STATUSES,
  closePdcaCheckpointStore,
  listPdcaWorkItems,
  writePdcaWorkItem,
} from '../../../src/tasks/PdcaWorkItemBridge';
import {
  closeTicketAssignmentStore,
  listTicketAssignments,
  upsertTicketAssignment,
} from '../../../src/tasks/ticketAssignmentStore';
import {
  buildCockpitSnapshot,
  checkCockpitInvariants,
  loadCockpitItems,
} from '../../../src/tasks/cockpit';

const ROOT = mkdtempSync(join(tmpdir(), 'p39-cockpit-db-'));
const PREVIOUS_DATA_DIR = process.env.LIRI_DATA_DIR;

/** 直接对库做计数（与面板无关的第二条路径 ⇒ 才能互为校验） */
function count(sql: string, params: unknown[] = []): number {
  const db = new Database(resolveDbPath(), { readonly: true });
  try {
    const statement = db.prepare(sql);
    try {
      const row = statement.get(...(params as never[])) as
        | { n?: number }
        | undefined;
      return Number(row?.n ?? 0);
    } finally {
      statement.finalize();
    }
  } finally {
    db.close();
  }
}

beforeAll(async () => {
  process.env.LIRI_DATA_DIR = ROOT;
  // 单例按路径键控 ⇒ 切目录后必须重建
  closePdcaCheckpointStore();
  closeTicketAssignmentStore();

  const now = new Date().toISOString();
  await writePdcaWorkItem({
    id: 'w-queued',
    title: '排队中',
    status: 'queued',
    updatedAt: now,
  });
  await writePdcaWorkItem({
    id: 'w-done',
    title: '已完成',
    status: 'completed',
    costTokens: 120,
    updatedAt: now,
  });
  await writePdcaWorkItem({
    id: 'w-failed',
    title: '已失败',
    status: 'failed',
    updatedAt: now,
  });
  await upsertTicketAssignment({
    assignmentId: 'a-1',
    workItemId: 'w-queued',
    executor: 'alwayson',
    state: 'running',
    startedAt: 1,
    updatedAt: 1,
  });
});

afterAll(async () => {
  closePdcaCheckpointStore();
  closeTicketAssignmentStore();
  if (PREVIOUS_DATA_DIR === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = PREVIOUS_DATA_DIR;
  // Windows 上 sqlite 句柄释放是异步回调 ⇒ 等一拍再删（否则偶发 EBUSY）
  await new Promise((resolve) => setTimeout(resolve, 50));
  rmSync(ROOT, { recursive: true, force: true });
});

async function snapshotOfDb() {
  const items = await loadCockpitItems({
    listWorkItems: () => listPdcaWorkItems(),
    listAssignments: (id) => listTicketAssignments(id),
    isEndedStatus: (status) => PDCA_TERMINAL_STATUSES.has(status),
  });
  return { items, snapshot: buildCockpitSnapshot(items, 1000) };
}

describe('P39 · 面板数字与 DB 计数一致', () => {
  it('total = workitems 行数（SQL 计数）', async () => {
    const dbRows = count('SELECT COUNT(*) AS n FROM workitems');
    const { snapshot } = await snapshotOfDb();

    expect(dbRows).toBe(3);
    expect(snapshot.metrics.total).toBe(dbRows);
  });

  it('endedCount = 终态 status 的 SQL 计数', async () => {
    const terminal = [...PDCA_TERMINAL_STATUSES];
    const placeholders = terminal.map(() => '?').join(', ');
    const dbEnded = count(
      `SELECT COUNT(*) AS n FROM workitems WHERE status IN (${placeholders})`,
      terminal
    );
    const { snapshot } = await snapshotOfDb();

    expect(dbEnded).toBe(2);
    expect(snapshot.metrics.endedCount).toBe(dbEnded);
  });

  it('分组长度之和 = 项总数，且快照自洽', async () => {
    const { items, snapshot } = await snapshotOfDb();
    const inGroups = snapshot.groups.reduce(
      (sum, group) => sum + group.items.length,
      0
    );

    expect(inGroups).toBe(items.length);
    expect(inGroups).toBe(count('SELECT COUNT(*) AS n FROM workitems'));
    expect(checkCockpitInvariants(snapshot, items)).toEqual([]);
  });

  it('派工来自 DB（ticket_assignments）⇒ 有派工项进入 working', async () => {
    const { snapshot } = await snapshotOfDb();
    const dbAssignments = count(
      'SELECT COUNT(*) AS n FROM ticket_assignments WHERE work_item_id = ?',
      ['w-queued']
    );
    expect(dbAssignments).toBe(1);
    expect(
      snapshot.groups.some(
        (group) => group.key === 'working' && group.items[0]?.id === 'w-queued'
      )
    ).toBe(true);
  });
});
