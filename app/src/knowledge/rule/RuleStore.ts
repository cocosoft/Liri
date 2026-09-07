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
 * RuleStore — 规则类知识存储（K3，kg_rules 表，统一 app.db）
 *
 * 以 rule_id 为主键 upsert；删除按来源文件批量清理（重编译防残留）。
 * 与 RecordStore 同模式（SimpleMutex 防 WAL 冲突），字段形态不同故独立。
 */

import { Database } from '@modules/core/external/sqlite3';
import { getLogger } from '@modules/monitoring';
import { resolveDbPath } from '@modules/core';
import { SimpleMutex } from '@modules/core';
import type { RuleRecord, RuleKind, ConstraintStrength } from './types';

const logger = getLogger('knowledge:rule:store');

/** kg_rules 表名 */
export const KG_RULES_TABLE = 'kg_rules';

/** 存储行（RuleRecord 去掉内存专属字段后基本同构） */
export type StoredRule = RuleRecord;

/** upsert 入参（不含 id/createdAt/updatedAt） */
export interface UpsertRuleInput {
  id: string;
  kind: RuleKind;
  statement: string;
  triggers?: string[];
  constraintStrength: ConstraintStrength;
  appliesTo?: string[];
  conflictOf?: string[];
  evidence?: Record<string, string>;
  domain?: string;
  sourceFile?: string;
}

/** 规则查询过滤 */
export interface RuleQuery {
  kind?: RuleKind;
  strength?: ConstraintStrength;
  domain?: string;
  limit?: number;
}

export class RuleStore {
  private db: Database | null = null;
  private dbPath: string;
  private dbMutex = new SimpleMutex();

  constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  /** 初始化连接并建表 */
  async init(): Promise<void> {
    if (this.db) return;

    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err: Error | null) => {
        if (err) reject(err);
        else resolve(db);
      });
    });

    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.run(
          `CREATE TABLE IF NOT EXISTS ${KG_RULES_TABLE} (
            rule_id         TEXT PRIMARY KEY,
            rule_kind       TEXT NOT NULL,
            statement       TEXT NOT NULL,
            triggers        TEXT NOT NULL DEFAULT '[]',
            strength        TEXT NOT NULL,
            applies_to      TEXT NOT NULL DEFAULT '[]',
            conflict_of     TEXT NOT NULL DEFAULT '[]',
            evidence        TEXT NOT NULL DEFAULT '{}',
            domain          TEXT NOT NULL DEFAULT 'knowledge',
            source_file     TEXT NOT NULL DEFAULT '',
            created_at      INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL
          )`,
          (err: Error | null) => {
            if (err) {
              reject(err);
              return;
            }
            this!.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_rules_kind ON ${KG_RULES_TABLE}(rule_kind)`
            );
            this!.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_rules_strength ON ${KG_RULES_TABLE}(strength)`
            );
            this!.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_rules_domain ON ${KG_RULES_TABLE}(domain)`
            );
            resolve();
          }
        );
      });
    });

    logger.info('规则存储已初始化');
  }

  /** upsert 一条规则 */
  async upsert(input: UpsertRuleInput): Promise<StoredRule> {
    if (!this.db) await this.init();

    const now = Date.now();
    const rule: StoredRule = {
      id: input.id,
      kind: input.kind,
      statement: input.statement,
      triggers: input.triggers ?? [],
      constraintStrength: input.constraintStrength,
      appliesTo: input.appliesTo ?? [],
      conflictOf: input.conflictOf ?? [],
      evidence: input.evidence ?? {},
      domain: input.domain ?? 'knowledge',
      sourceFile: input.sourceFile ?? '',
      createdAt: now,
      updatedAt: now,
    };

    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.run(
          `INSERT INTO ${KG_RULES_TABLE}
             (rule_id, rule_kind, statement, triggers, strength, applies_to,
              conflict_of, evidence, domain, source_file, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(rule_id) DO UPDATE SET
             rule_kind = excluded.rule_kind,
             statement = excluded.statement,
             triggers = excluded.triggers,
             strength = excluded.strength,
             applies_to = excluded.applies_to,
             conflict_of = excluded.conflict_of,
             evidence = excluded.evidence,
             domain = excluded.domain,
             source_file = excluded.source_file,
             updated_at = excluded.updated_at`,
          [
            rule.id,
            rule.kind,
            rule.statement,
            JSON.stringify(rule.triggers),
            rule.constraintStrength,
            JSON.stringify(rule.appliesTo ?? []),
            JSON.stringify(rule.conflictOf),
            JSON.stringify(rule.evidence),
            rule.domain,
            rule.sourceFile,
            rule.createdAt,
            rule.updatedAt,
          ],
          (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    });

    return rule;
  }

  /** 按关键字检索规则（statement/triggers 模糊），可按类别/强度过滤 */
  async search(q: string, filters: RuleQuery = {}): Promise<StoredRule[]> {
    if (!this.db) await this.init();

    const conditions: string[] = [];
    const params: unknown[] = [];

    conditions.push('(statement LIKE ? OR triggers LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like);

    if (filters.kind) {
      conditions.push('rule_kind = ?');
      params.push(filters.kind);
    }
    if (filters.strength) {
      conditions.push('strength = ?');
      params.push(filters.strength);
    }
    if (filters.domain) {
      conditions.push('domain = ?');
      params.push(filters.domain);
    }

    const limit = filters.limit ?? 20;

    const sql = `SELECT * FROM ${KG_RULES_TABLE}
      WHERE ${conditions.join(' AND ')}
      ORDER BY updated_at DESC LIMIT ?`;

    return new Promise((resolve, reject) => {
      this.db!.all(
        sql,
        [...params, limit],
        (err: Error | null, rows: unknown[]) => {
          if (err) {
            reject(err);
            return;
          }
          resolve(rows.map((r) => this.rowToRule(r)));
        }
      );
    });
  }

  /** 按来源页面文件列出该页全部规则（K5 血缘：page → rule 反查） */
  async listBySourceFile(sourceFile: string): Promise<StoredRule[]> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${KG_RULES_TABLE} WHERE source_file = ? ORDER BY created_at`,
        [sourceFile],
        (err: Error | null, rows: unknown[]) => {
          if (err) {
            reject(err);
            return;
          }
          resolve((rows as unknown[]).map((r) => this.rowToRule(r)));
        }
      );
    });
  }

  /** 删除某来源文件的全部规则（重编译防残留） */
  async deleteBySource(sourceFile: string): Promise<number> {
    if (!this.db) await this.init();

    let affected = 0;
    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.all(
          `SELECT rule_id FROM ${KG_RULES_TABLE} WHERE source_file = ?`,
          [sourceFile],
          (err: Error | null, rows: unknown[]) => {
            if (err) {
              reject(err);
              return;
            }
            const ids = rows.map((r) => (r as { rule_id: string }).rule_id);
            affected = ids.length;
            if (ids.length === 0) {
              resolve();
              return;
            }
            const placeholders = ids.map(() => '?').join(',');
            this.db!.run(
              `DELETE FROM ${KG_RULES_TABLE} WHERE rule_id IN (${placeholders})`,
              ids,
              (delErr: Error | null) => {
                if (delErr) reject(delErr);
                else resolve();
              }
            );
          }
        );
      });
    });

    return affected;
  }

  /** 规则总数（可细分类别） */
  async count(kind?: RuleKind): Promise<number> {
    if (!this.db) await this.init();

    const sql = kind
      ? `SELECT COUNT(*) AS n FROM ${KG_RULES_TABLE} WHERE rule_kind = ?`
      : `SELECT COUNT(*) AS n FROM ${KG_RULES_TABLE}`;
    const params = kind ? [kind] : [];

    return new Promise((resolve, reject) => {
      this.db!.get(sql, params, (err: Error | null, row: unknown) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(Number((row as { n?: number } | undefined)?.n ?? 0));
      });
    });
  }

  /** 关闭连接 */
  async close(): Promise<void> {
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      this.db!.close((err: Error | null) => {
        if (err) reject(err);
        else {
          this.db = null;
          resolve();
        }
      });
    });
  }

  /** 行 → StoredRule */
  private rowToRule(row: unknown): StoredRule {
    const r = row as {
      rule_id?: string;
      rule_kind?: string;
      statement?: string;
      triggers?: string;
      strength?: string;
      applies_to?: string;
      conflict_of?: string;
      evidence?: string;
      domain?: string;
      source_file?: string;
      created_at?: number;
      updated_at?: number;
    };
    return {
      id: r.rule_id ?? '',
      kind: (r.rule_kind ?? 'guideline') as RuleKind,
      statement: r.statement ?? '',
      triggers: this.parseStringArray(r.triggers),
      constraintStrength: (r.strength ?? 'should') as ConstraintStrength,
      appliesTo: this.parseStringArray(r.applies_to),
      conflictOf: this.parseStringArray(r.conflict_of),
      evidence: this.parseStringMap(r.evidence),
      domain: r.domain ?? 'knowledge',
      sourceFile: r.source_file ?? '',
      createdAt: r.created_at ?? 0,
      updatedAt: r.updated_at ?? 0,
    };
  }

  private parseStringArray(raw: string | undefined): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === 'string')
        : [];
    } catch {
      return [];
    }
  }

  private parseStringMap(raw: string | undefined): Record<string, string> {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') result[k] = v;
      }
      return result;
    } catch {
      return {};
    }
  }
}
