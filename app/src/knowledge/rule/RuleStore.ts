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
 * RuleStore — 规则类知识存储（K3，kg_rules 表，租户级 DB）
 *
 * 以 rule_id 为主键 upsert；删除按来源文件批量清理（重编译防残留）。
 * 与 RecordStore 同模式（SimpleMutex 防 WAL 冲突），字段形态不同故独立。
 *
 * **归属（2026-10-25，租户级 DB §6.1）**：编译产物属**用户级**数据 —— 库按**租户**分
 * （`tenants/<t>/app.db`），租户内按 `owner_key`（`<tenant>:<user>`）行级隔离，
 * 与同域先例 `KnowledgeGraph`（`kg_edges` 已 owner_key 隔离）同口径。
 * 直接 `new RuleStore()`（编译写路径 / 检索读路径）在 **init 时按当前请求身份**
 * 解析库（`resolveTenantDbPath()`：本地 ⇒ 共享 `app.db`，已认证 ⇒ 租户库）⇒
 * 定时编译（调度器无请求身份）落 `local:local`，手动 / HTTP 编译落所属用户桶。
 * 单例取用走 `getRuleStore()`（按 tenantId 分桶，删租户时释放）。
 */

import { Database } from '@openliri/kernel/external/sqlite3';
import { getLogger } from '@modules/monitoring';
import { resolveTenantDbPath } from '@openliri/kernel/paths';
import {
  getRequestPrincipal,
  getRequestPrincipalKey,
  isLocalPrincipal,
  principalKeyOf,
} from '@openliri/kernel/identity/requestScope.js';
import { registerScopedResource } from '@openliri/kernel/identity/scopedResources.js';
import { SimpleMutex } from '@openliri/kernel';
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
  private dbPath?: string;
  private dbMutex = new SimpleMutex();
  /** 进行中的初始化（并发调用共享，避免重复打开连接） */
  private initPromise: Promise<void> | null = null;
  /**
   * 表的主键是否含 `owner_key`（复合 PK `(rule_id, owner_key)`）。
   * 新库（租户库 / 新建本地库）⇒ true；**旧库**（ALTER 补列，PK 仍是 `rule_id` 单列）⇒ false。
   * 决定 upsert 的 ON CONFLICT 目标：复合 PK 必须是 `ON CONFLICT(rule_id, owner_key)`，
   * 单列 PK 用 `ON CONFLICT(rule_id)`（写错会 prepare 报
   * "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint"）。
   */
  private pkIncludesOwner = false;

  /**
   * @param dbPath 显式库路径（测试/工具注入）；缺省由 `init()` 惰性解析 ——
   *   `resolveTenantDbPath()` 按**当前请求身份**解析（本地 ⇒ 共享 `app.db`；已认证 ⇒
   *   `tenants/<t>/app.db`）。2026-10-25 租户级 DB §6.1：默认参数会在**构造时**解析路径，
   *   模块级单例在无请求身份下构造会把库钉死共享 `app.db` ⇒ 改惰性解析。
   */
  constructor(dbPath?: string) {
    this.dbPath = dbPath;
  }

  /** 初始化连接并建表（幂等 + 并发安全） */
  async init(): Promise<void> {
    if (this.db) {
      return;
    }
    if (!this.initPromise) {
      this.initPromise = this.doInit();
    }
    try {
      await this.initPromise;
    } catch (err) {
      // 与 TaskGoalStore 同法：失败必须清空，否则一次瞬时故障永久失效
      this.initPromise = null;
      throw err;
    }
  }

  private async doInit(): Promise<void> {
    const dbPath = this.dbPath ?? resolveTenantDbPath();
    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(dbPath, (err: Error | null) => {
        if (err) reject(err);
        else resolve(db);
      });
    });

    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.run(
          `CREATE TABLE IF NOT EXISTS ${KG_RULES_TABLE} (
            rule_id         TEXT NOT NULL,
            owner_key       TEXT NOT NULL DEFAULT 'local:local',
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
            updated_at      INTEGER NOT NULL,
            PRIMARY KEY (rule_id, owner_key)
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
            // 归属列走索引（2026-10-25）：`search` / `listAll` 以 owner_key 起手过滤
            this!.db!.run(
              `CREATE INDEX IF NOT EXISTS idx_rules_owner ON ${KG_RULES_TABLE}(owner_key, updated_at DESC)`
            );
            // 补 owner_key 列（2026-10-25，租户级 DB §6.1）：已建表的库没有该列。
            // SQLite 的 `ALTER TABLE` 不能改主键 ⇒ 旧库保持 `rule_id` 单列 PK；旧库只可能
            // 是本地库（只含 `local:local` 行）⇒ 不会与租户行碰撞（存量行落默认值即本地身份）。
            // sqlite3 db.run 无回调时静默吞错 ⇒ 必须传回调判成败，`/duplicate column/i` 过滤。
            this!.db!.run(
              `ALTER TABLE ${KG_RULES_TABLE} ADD COLUMN owner_key TEXT NOT NULL DEFAULT 'local:local'`,
              (alterErr: Error | null) => {
                if (alterErr && !/duplicate column/i.test(alterErr.message)) {
                  logger.warn('kg_rules 补 owner_key 失败', {
                    error: alterErr.message,
                  });
                }
                // 探测主键形态（决定 upsert 的 ON CONFLICT 目标）
                this!.db!.all(
                  `PRAGMA table_info(${KG_RULES_TABLE})`,
                  (
                    pErr: Error | null,
                    cols: Array<{ name: string; pk: number }> | undefined
                  ) => {
                    if (!pErr) {
                      this!.pkIncludesOwner = Boolean(
                        (cols ?? []).some(
                          (c) => c.name === 'owner_key' && c.pk > 0
                        )
                      );
                    }
                    resolve();
                  }
                );
              }
            );
          }
        );
      });
    });

    logger.info('规则存储已初始化');
  }

  /** 当前身份归属键（本地 ⇒ `local:local`；租户 ⇒ `<tenant>:<user>`） */
  private owner(): string {
    return getRequestPrincipalKey();
  }

  /** upsert 一条规则 */
  async upsert(input: UpsertRuleInput): Promise<StoredRule> {
    await this.init();

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

    // 复合 PK（新库）⇒ 冲突目标含 owner_key，两用户的同 rule_id 是**不同行**；
    // 旧库（单列 PK）⇒ 冲突目标仅 rule_id（旧库只有 local:local，天然不跨用户）。
    // 目标不带括号 —— 模板里 `ON CONFLICT(${target})` 负责加括号，否则会叠成
    // `ON CONFLICT((rule_id, owner_key))`（实测 SQLite prepare 报不匹配）。
    const conflictTarget = this.pkIncludesOwner
      ? 'rule_id, owner_key'
      : 'rule_id';

    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        const sql = `INSERT INTO ${KG_RULES_TABLE}
           (rule_id, owner_key, rule_kind, statement, triggers, strength, applies_to,
            conflict_of, evidence, domain, source_file, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(${conflictTarget}) DO UPDATE SET
           rule_kind = excluded.rule_kind,
           statement = excluded.statement,
           triggers = excluded.triggers,
           strength = excluded.strength,
           applies_to = excluded.applies_to,
           conflict_of = excluded.conflict_of,
           evidence = excluded.evidence,
           domain = excluded.domain,
           source_file = excluded.source_file,
           updated_at = excluded.updated_at`;
        this.db!.run(
          sql,
          [
            rule.id,
            this.owner(),
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
    await this.init();

    const like = `%${q}%`;
    // 归属条件起手（2026-10-25）：租户内两用户的编译产物互不可见
    const params: unknown[] = [this.owner(), like, like];

    let sql = `SELECT * FROM ${KG_RULES_TABLE}
      WHERE owner_key = ?
      AND (statement LIKE ? OR triggers LIKE ?)`;

    if (filters.kind) {
      sql += ' AND rule_kind = ?';
      params.push(filters.kind);
    }
    if (filters.strength) {
      sql += ' AND strength = ?';
      params.push(filters.strength);
    }
    if (filters.domain) {
      sql += ' AND domain = ?';
      params.push(filters.domain);
    }

    sql += ' ORDER BY updated_at DESC LIMIT ?';
    params.push(filters.limit ?? 20);

    return new Promise((resolve, reject) => {
      this.db!.all(sql, params, (err: Error | null, rows: unknown[]) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(rows.map((r) => this.rowToRule(r)));
      });
    });
  }

  /** 按来源页面文件列出该页全部规则（K5 血缘：page → rule 反查） */
  async listBySourceFile(sourceFile: string): Promise<StoredRule[]> {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${KG_RULES_TABLE} WHERE source_file = ? AND owner_key = ? ORDER BY created_at`,
        [sourceFile, this.owner()],
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

  /** 列出当前归属的全部规则（R3 跨批 conflictOf 全表扫描用，扫描面=当前用户） */
  async listAll(): Promise<StoredRule[]> {
    await this.init();

    return new Promise((resolve, reject) => {
      this.db!.all(
        `SELECT * FROM ${KG_RULES_TABLE} WHERE owner_key = ? ORDER BY created_at`,
        [this.owner()],
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

  /** 删除某来源文件的全部规则（重编译防残留；只删当前归属的行） */
  async deleteBySource(sourceFile: string): Promise<number> {
    await this.init();

    let affected = 0;
    await this.dbMutex.run<void>(() => {
      return new Promise((resolve, reject) => {
        this.db!.all(
          `SELECT rule_id FROM ${KG_RULES_TABLE} WHERE source_file = ? AND owner_key = ?`,
          [sourceFile, this.owner()],
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
              `DELETE FROM ${KG_RULES_TABLE} WHERE rule_id IN (${placeholders}) AND owner_key = ?`,
              [...ids, this.owner()],
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

  /** 规则总数（可细分类别；计数面=当前归属） */
  async count(kind?: RuleKind): Promise<number> {
    await this.init();

    const sql = kind
      ? `SELECT COUNT(*) AS n FROM ${KG_RULES_TABLE} WHERE rule_kind = ? AND owner_key = ?`
      : `SELECT COUNT(*) AS n FROM ${KG_RULES_TABLE} WHERE owner_key = ?`;
    const params = kind ? [kind, this.owner()] : [this.owner()];

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
          this.initPromise = null;
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

/** 全局单例（本地身份；库由 `init()` 惰性解析） */
let instance: RuleStore | null = null;
/** 租户级实例缓存（键 = `tenantId`；同租户共用连接，按 `owner_key` 行级隔离） */
const scopedInstances = new Map<string, RuleStore>();
/** 显式 `dbPath` 实例缓存（键 = 路径；仅测试/工具注入） */
const explicitInstances = new Map<string, RuleStore>();

/** 获取 RuleStore 单例（方法内部自 `await init()`，调用方无需预热） */
export function getRuleStore(dbPath?: string): RuleStore {
  // 2026-10-25：显式路径（测试/工具注入）按路径分桶，**不**复用默认单例
  if (dbPath !== undefined) {
    const existing = explicitInstances.get(dbPath);
    if (existing) return existing;
    const created = new RuleStore(dbPath);
    explicitInstances.set(dbPath, created);
    return created;
  }
  const principal = getRequestPrincipal();
  if (!isLocalPrincipal(principal)) {
    const key = principal.tenantId;
    const existing = scopedInstances.get(key);
    if (existing) return existing;
    const scoped = new RuleStore(resolveTenantDbPath(principal));
    scopedInstances.set(key, scoped);
    // 删租户 / 退出时释放句柄并摘除缓存（否则 Windows 上 tenants/<t> 删不掉）
    registerScopedResource(principalKeyOf(principal), () => {
      void scoped.close();
      scopedInstances.delete(key);
    });
    return scoped;
  }
  if (!instance) {
    instance = new RuleStore(dbPath);
  }
  return instance;
}

/** 仅测试：关掉并清空租户级实例缓存（**生产不调用**） */
export function resetRuleStoreScopedForTest(): void {
  for (const store of scopedInstances.values()) {
    void store.close();
  }
  scopedInstances.clear();
}
