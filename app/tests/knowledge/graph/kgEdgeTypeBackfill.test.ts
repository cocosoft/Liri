/**
 * kg_edges.edge_type 回填脚本的**纯函数**单测（D8，2026-11-18）
 *
 * 覆盖：计划折算（别名收敛 / 幂等 / 空值兜底 / 降序）+ 冲突感知 SQL（内存库，不碰真实数据）。
 */
import { describe, expect, it } from 'bun:test';

import { Database } from '@openliri/infra/external';

import {
  SQL_SELECT_UPDATABLE_EDGE_IDS,
  planEdgeTypeBackfill,
} from '../../../scripts/backfill-kg-edge-types';

describe('planEdgeTypeBackfill', () => {
  it('别名/大小写/分隔符 ⇒ 规范名（复用 normalizeRelationType）', () => {
    const plan = planEdgeTypeBackfill([
      { edge_type: 'works_at', count: 3 },
      { edge_type: 'Works-At', count: 1 },
      { edge_type: 'is_a', count: 2 },
      { edge_type: 'mentions_entity', count: 4 },
    ]);
    expect(plan).toEqual(
      expect.arrayContaining([
        { from: 'works_at', to: 'works_for', count: 3 },
        { from: 'Works-At', to: 'works_for', count: 1 },
        { from: 'is_a', to: 'subtype_of', count: 2 },
        { from: 'mentions_entity', to: 'mentions', count: 4 },
      ])
    );
  });

  it('已是规范名 ⇒ 不进计划（幂等：再跑一遍为空）', () => {
    const plan = planEdgeTypeBackfill([
      { edge_type: 'works_for', count: 9 },
      { edge_type: 'related_to', count: 5 },
    ]);
    expect(plan).toEqual([]);
  });

  it('空串 ⇒ related_to（与本体「空值兜底」同口径）', () => {
    expect(planEdgeTypeBackfill([{ edge_type: '', count: 1 }])).toEqual([
      { from: '', to: 'related_to', count: 1 },
    ]);
  });

  it('按行数降序（先看大头）', () => {
    const plan = planEdgeTypeBackfill([
      { edge_type: 'is_a', count: 2 },
      { edge_type: 'works_at', count: 50 },
    ]);
    expect(plan.map((r) => r.from)).toEqual(['works_at', 'is_a']);
  });
});

describe('SQL_SELECT_UPDATABLE_EDGE_IDS（冲突感知）', () => {
  /**
   * 必要性：`kg_edges` 有唯一索引
   * `(from_id, to_id, edge_type, COALESCE(domain,''))` —— 直接改名会撞上既有规范边
   * （2026-11-18 真机 `--apply` 实测 `UNIQUE constraint failed` 并整笔回滚）。
   */
  function openMemoryDb(): Promise<Database> {
    return new Promise((resolve, reject) => {
      const db = new Database(':memory:', (err: Error | null) => {
        if (err) reject(err);
        else resolve(db);
      });
    });
  }

  function exec(
    db: Database,
    sql: string,
    params: unknown[] = []
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      db.run(sql, params, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  function query(
    db: Database,
    sql: string,
    params: unknown[] = []
  ): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err: Error | null, rows: unknown[]) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  it('只返回改后不会重复的行；冲突行不进集合', async () => {
    const db = await openMemoryDb();
    try {
      await exec(
        db,
        `CREATE TABLE kg_edges (
           edge_id TEXT, from_id TEXT, to_id TEXT, edge_type TEXT, domain TEXT, owner_key TEXT
         )`
      );
      const ins =
        'INSERT INTO kg_edges (edge_id, from_id, to_id, edge_type, domain, owner_key) VALUES (?,?,?,?,?,?)';
      // 无冲突：无既有 works_for
      await exec(db, ins, ['e1', 'a', 'b', 'works_at', null, 'local:local']);
      // 冲突：同三元组 + 同域已有 works_for
      await exec(db, ins, ['e2', 'c', 'd', 'works_at', '', 'local:local']);
      await exec(db, ins, ['e3', 'c', 'd', 'works_for', '', 'local:local']);
      // 同三元组但**不同域** ⇒ 不冲突（唯一索引含域）
      await exec(db, ins, ['e4', 'e', 'f', 'works_at', 'd1', 'local:local']);
      await exec(db, ins, ['e5', 'e', 'f', 'works_for', 'd2', 'local:local']);

      const rows = (await query(db, SQL_SELECT_UPDATABLE_EDGE_IDS, [
        'works_at',
        'works_for',
      ])) as Array<{ id: string; owner: string }>;

      expect(rows.map((r) => r.id).sort()).toEqual(['e1', 'e4']);
      expect(rows[0].owner).toBe('local:local');
    } finally {
      await new Promise<void>((resolve) => db.close(() => resolve()));
    }
  });
});
