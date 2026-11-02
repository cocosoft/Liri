/**
 * P34 · workitems `subscriptions` / `inputs` / `budget_*` 列（2026-11-02）
 *
 * 用临时 `LIRI_DATA_DIR` 建独立库，验证：写入后能从语义列往返读出（`data` 仍是事实源）。
 */
import { afterAll, beforeAll, describe, it, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  closePdcaCheckpointStore,
  listPdcaWorkItemsBySession,
  writePdcaWorkItem,
} from '../../src/tasks/PdcaWorkItemBridge';

const ROOT = mkdtempSync(join(tmpdir(), 'p34-cols-'));
const PREVIOUS_DATA_DIR = process.env.LIRI_DATA_DIR;

beforeAll(() => {
  process.env.LIRI_DATA_DIR = ROOT;
  // 确保按新路径重新建库（单例按路径键控）
  closePdcaCheckpointStore();
});

afterAll(() => {
  closePdcaCheckpointStore();
  if (PREVIOUS_DATA_DIR === undefined) delete process.env.LIRI_DATA_DIR;
  else process.env.LIRI_DATA_DIR = PREVIOUS_DATA_DIR;
  rmSync(ROOT, { recursive: true, force: true });
});

describe('P34 · workitems 订阅/输入/预算列', () => {
  it('写入后按会话读回：subscriptions / inputs / budget_* 完整', async () => {
    const now = new Date().toISOString();
    await writePdcaWorkItem({
      id: 'w-cols',
      title: '列往返',
      status: 'active',
      sessionId: 's-cols',
      sourceId: 'cron',
      origin: { threadId: 'cron:job-1' },
      subscriptions: [{ source: 'cron', threadId: 'cron:job-1' }],
      inputs: [{ kind: 'trigger', triggerId: 'tg1-1', at: 1000 }],
      budgetMaxTokens: 1000,
      budgetUsedTokens: 250,
      budgetMaxUsd: 1.5,
      budgetUsedUsd: 0.25,
      updatedAt: now,
    });

    const rows = await listPdcaWorkItemsBySession('s-cols');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'w-cols',
      subscriptions: [{ source: 'cron', threadId: 'cron:job-1' }],
      inputs: [{ kind: 'trigger', triggerId: 'tg1-1', at: 1000 }],
      budgetMaxTokens: 1000,
      budgetUsedTokens: 250,
      budgetMaxUsd: 1.5,
      budgetUsedUsd: 0.25,
    });
  });

  it('未提供 ⇒ 不臆造（字段缺省）', async () => {
    await writePdcaWorkItem({
      id: 'w-empty',
      title: '无预算',
      status: 'active',
      sessionId: 's-empty',
      updatedAt: new Date().toISOString(),
    });

    const rows = await listPdcaWorkItemsBySession('s-empty');
    expect(rows[0]?.subscriptions).toBeUndefined();
    expect(rows[0]?.inputs).toBeUndefined();
    expect(rows[0]?.budgetMaxTokens).toBeUndefined();
    expect(rows[0]?.budgetUsedUsd).toBeUndefined();
  });
});
