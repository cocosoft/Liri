/**
 * PDCA ↔ WorkItem 状态桥接
 *
 * 共享模块，供 pdca-handlers（HTTP 层，经 `TaskOpsPort` 端口）和
 * LongRunningTaskOrchestrator（任务层）共同引用。
 *
 * **存储（GAI-3，2026-10-05）**：检查点 / WorkItem 由"每任务一个 JSON 文件"
 * 迁入唯一 `app.db`（SQLite WAL + 事务），消除（a）全目录解析开销与
 * （b）读改写（RMW）竞态 —— 原实现"读整文件 → 合并 → 覆盖写"，多通道并发写同一
 * taskId 时后写覆盖前写（丢失 workItemId/status/…）。范式对齐
 * [`CheckpointDatabase`](../chat/services/CheckpointDatabase.ts)（R01 基础设施复用）。
 *
 * **模型**：`data` 列存完整检查点 JSON（字段自由演进），热字段提升为独立列供索引/过滤。
 */

import { join } from 'path';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { Database } from '@modules/core/external/sqlite3';
import { resolveDbPath, resolveDataSubDir } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import {
  type PdcaPhase,
  PDCA_TO_WORKITEM,
  PDCA_TERMINAL_PHASES,
} from '@modules/core';
export type { PdcaPhase };
export { PDCA_TERMINAL_PHASES } from '@modules/core';

const logger = getLogger('tasks:pdcaBridge');

// ─── 表名（新增表；`app.db` 无同名表，见 spec §3.1 冲突前置校验） ───
const CHECKPOINT_TABLE = 'pdca_checkpoints';
const WORKITEM_TABLE = 'workitems';

/** 从记录中取非空字符串（否则 null，用于提升列） */
function strOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/** 解析 ISO 时间戳；无法解析返回 null */
function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** 读取文件 mtime（ISO）；失败返回 null */
function fileMtimeIso(filePath: string): string | null {
  try {
    return statSync(filePath).mtime.toISOString();
  } catch {
    // @ignore-catch: readdir 与 stat 之间文件被删除的竞态 ⇒ 视为无 mtime
    return null;
  }
}

/** 解析 `data` 列 JSON；损坏时留痕并返回 null（KB-PDCA-READ-LOG 保留） */
function parseCheckpointData(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : null;
  } catch (err) {
    logger.warn('PDCA 检查点 JSON 解析失败，按无记录处理', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * PDCA 检查点 / WorkItem 的 SQLite 存储（惰性单例，照 `CheckpointDatabase` 范式）。
 *
 * - `constructor(dbPath = resolveDbPath())` + 惰性 `init()` + `createTables()`；
 * - 写入经 `enqueue` **串行化**后做"读改写 + UPSERT"：bun:sqlite 为单连接，
 *   一次 RMW 跨 `await` 边界时并发写会交错 ⇒ 必须以队列串行化（这才是消除
 *   RMW 覆盖的根因；DB 事务/原子 UPSERT 是存储层保证，队列仅守本模块单连接）。
 */
class PdcaCheckpointStore {
  private db: Database | null = null;
  /** 首次连接 + 建表的 Promise（缓存以消除并发首调重复建连） */
  private initPromise: Promise<Database> | null = null;
  /** 写操作串行链（保证"读改写"不并发交错） */
  private writeChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly dbPath: string = resolveDbPath()) {}

  private init(): Promise<Database> {
    if (this.db) return Promise.resolve(this.db);
    this.initPromise ??= this.openAndCreateTables();
    return this.initPromise;
  }

  private async openAndCreateTables(): Promise<Database> {
    const db = await new Promise<Database>((resolve, reject) => {
      const d = new Database(this.dbPath, (err) => {
        if (err) reject(err);
        else resolve(d);
      });
    });
    try {
      await this.createTables(db);
    } catch (err) {
      // 建表失败 ⇒ 释放连接并允许后续重试（不留半初始化状态）
      db.close(() => {
        // @ignore-catch: 建表失败路径下尽力释放连接，关闭错误无需再上报
      });
      this.initPromise = null;
      throw err;
    }
    this.db = db;
    return db;
  }

  private async createTables(db: Database): Promise<void> {
    const ddl = [
      `CREATE TABLE IF NOT EXISTS ${CHECKPOINT_TABLE} (
        task_id       TEXT PRIMARY KEY,
        data          TEXT NOT NULL,
        phase         TEXT,
        status        TEXT,
        work_item_id  TEXT,
        workspace_id  TEXT,
        project_id    TEXT,
        updated_at    TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_pdca_checkpoints_updated_at ON ${CHECKPOINT_TABLE}(updated_at)`,
      `CREATE TABLE IF NOT EXISTS ${WORKITEM_TABLE} (
        work_item_id  TEXT PRIMARY KEY,
        data          TEXT NOT NULL,
        status        TEXT,
        updated_at    TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_workitems_status ON ${WORKITEM_TABLE}(status)`,
    ];
    for (const sql of ddl) {
      await new Promise<void>((resolve, reject) => {
        db.run(sql, (err) => (err ? reject(err) : resolve()));
      });
    }
  }

  private async run(sql: string, params: unknown[] = []): Promise<void> {
    const db = await this.init();
    await new Promise<void>((resolve, reject) => {
      db.run(sql, params, (err) => (err ? reject(err) : resolve()));
    });
  }

  private async getRow(
    sql: string,
    params: unknown[] = []
  ): Promise<Record<string, unknown> | null> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve((row as Record<string, unknown> | undefined) ?? null);
      });
    });
  }

  private async allRows(
    sql: string,
    params: unknown[] = []
  ): Promise<Array<Record<string, unknown>>> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else
          resolve((rows as Array<Record<string, unknown>> | undefined) ?? []);
      });
    });
  }

  /** 串行执行写操作（失败不阻断后续链） */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(fn, fn);
    this.writeChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  /** 关闭并释放连接（供测试切换 DB 路径 / 清理前调用） */
  close(): void {
    const db = this.db;
    this.db = null;
    this.initPromise = null;
    if (!db) return;
    db.close((err) => {
      if (err) {
        logger.warn('PDCA 检查点 DB 关闭失败', {
          dbPath: this.dbPath,
          error: err.message,
        });
      }
    });
  }

  async readCheckpoint(
    taskId: string
  ): Promise<Record<string, unknown> | null> {
    const row = await this.getRow(
      `SELECT data FROM ${CHECKPOINT_TABLE} WHERE task_id = ?`,
      [taskId]
    );
    return row ? parseCheckpointData(row.data) : null;
  }

  /**
   * **原子合并写**：读改写经写队列串行化，UPSERT 单条 SQL 落库。
   * 合并语义与旧实现逐字一致（`{...existing, ...patch, updatedAt: now}`）。
   */
  async writeCheckpoint(
    taskId: string,
    patch: Record<string, unknown>
  ): Promise<void> {
    await this.enqueue(async () => {
      const row = await this.getRow(
        `SELECT data FROM ${CHECKPOINT_TABLE} WHERE task_id = ?`,
        [taskId]
      );
      const existing = row ? (parseCheckpointData(row.data) ?? {}) : {};
      const merged: Record<string, unknown> = {
        ...existing,
        ...patch,
        updatedAt: new Date().toISOString(),
      };
      await this.upsertCheckpoint(taskId, merged, merged.updatedAt as string);
    });
  }

  /** 迁移导入（幂等：表中已存在该 task_id ⇒ 跳过；`updatedAt` 取源值，不刷新为 now） */
  async importCheckpoint(
    taskId: string,
    data: Record<string, unknown>,
    updatedAt: string
  ): Promise<boolean> {
    return this.enqueue(async () => {
      const existing = await this.getRow(
        `SELECT 1 AS present FROM ${CHECKPOINT_TABLE} WHERE task_id = ?`,
        [taskId]
      );
      if (existing) return false;
      await this.upsertCheckpoint(taskId, data, updatedAt);
      return true;
    });
  }

  private async upsertCheckpoint(
    taskId: string,
    data: Record<string, unknown>,
    updatedAt: string
  ): Promise<void> {
    await this.run(
      `INSERT INTO ${CHECKPOINT_TABLE}
        (task_id, data, phase, status, work_item_id, workspace_id, project_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(task_id) DO UPDATE SET
         data = excluded.data,
         phase = excluded.phase,
         status = excluded.status,
         work_item_id = excluded.work_item_id,
         workspace_id = excluded.workspace_id,
         project_id = excluded.project_id,
         updated_at = excluded.updated_at`,
      [
        taskId,
        JSON.stringify(data),
        strOrNull(data.phase),
        strOrNull(data.status),
        strOrNull(data.workItemId),
        strOrNull(data.workspaceId),
        strOrNull(data.projectId),
        updatedAt,
      ]
    );
  }

  async listCheckpoints(): Promise<Array<Record<string, unknown>>> {
    const rows = await this.allRows(
      `SELECT data FROM ${CHECKPOINT_TABLE} ORDER BY task_id`
    );
    const out: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      const data = parseCheckpointData(row.data);
      if (data) out.push(data);
    }
    return out;
  }

  async checkpointIndex(): Promise<Map<string, Record<string, unknown>>> {
    const index = new Map<string, Record<string, unknown>>();
    for (const ck of await this.listCheckpoints()) {
      if (typeof ck.taskId === 'string') index.set(ck.taskId, ck);
    }
    return index;
  }

  /** 留存清理（判据不变）：按条件 DELETE，分类/计数语义与旧文件实现一致 */
  async prune(maxAgeDays: number): Promise<PdcaCheckpointPruneResult> {
    const result: PdcaCheckpointPruneResult = {
      scanned: 0,
      pruned: 0,
      prunedTerminal: 0,
      prunedOrphan: 0,
      keptFresh: 0,
      keptActive: 0,
      errors: 0,
    };

    const rows = await this.allRows(
      `SELECT task_id, phase, status, updated_at FROM ${CHECKPOINT_TABLE}`
    );
    const cutoff = Date.now() - maxAgeDays * DAY_MS;
    const toDelete: Array<{ taskId: string; terminal: boolean }> = [];

    for (const row of rows) {
      result.scanned++;

      const taskId = typeof row.task_id === 'string' ? row.task_id : '';
      const phase = typeof row.phase === 'string' ? row.phase : '';
      const status = typeof row.status === 'string' ? row.status : '';

      const isTerminal =
        PDCA_TERMINAL_PHASES.has(phase) || PDCA_TERMINAL_STATUSES.has(status);
      // 孤儿：非终态、且"没在跑、也不在等审批" ⇒ 历史残留（判据说明见 PDCA_CHECKPOINT_RETENTION_DAYS）
      const isOrphan =
        !isTerminal &&
        !PDCA_ACTIVE_STATUSES.has(status) &&
        !PDCA_AWAITING_APPROVAL_PHASES.has(phase);

      if (!taskId || !(isTerminal || isOrphan)) {
        result.keptActive++;
        continue;
      }

      const at = parseTimestampMs(row.updated_at);
      if (at === null || at > cutoff) {
        result.keptFresh++;
        continue;
      }
      toDelete.push({ taskId, terminal: isTerminal });
    }

    for (const { taskId, terminal } of toDelete) {
      try {
        await this.run(`DELETE FROM ${CHECKPOINT_TABLE} WHERE task_id = ?`, [
          taskId,
        ]);
        result.pruned++;
        if (terminal) result.prunedTerminal++;
        else result.prunedOrphan++;
      } catch (err) {
        result.errors++;
        logger.warn('PDCA 检查点留存删除失败（跳过）', {
          taskId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (result.pruned > 0 || result.errors > 0) {
      logger.info('PDCA 检查点留存清理完成', {
        maxAgeDays,
        ...result,
      });
    }
    return result;
  }

  async readWorkItem(
    workItemId: string
  ): Promise<Record<string, unknown> | null> {
    const row = await this.getRow(
      `SELECT data FROM ${WORKITEM_TABLE} WHERE work_item_id = ?`,
      [workItemId]
    );
    return row ? parseCheckpointData(row.data) : null;
  }

  /** WorkItem UPSERT（`work_item_id` = 记录 `id`） */
  async writeWorkItem(record: Record<string, unknown>): Promise<void> {
    const workItemId = strOrNull(record.id);
    if (!workItemId) return; // 无 id 不落库（旧实现由调用方保证 item.id 存在）
    const updatedAt =
      parseTimestampMs(record.updatedAt) === null
        ? new Date().toISOString()
        : (record.updatedAt as string);
    await this.enqueue(() =>
      this.run(
        `INSERT INTO ${WORKITEM_TABLE} (work_item_id, data, status, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(work_item_id) DO UPDATE SET
           data = excluded.data,
           status = excluded.status,
           updated_at = excluded.updated_at`,
        [
          workItemId,
          JSON.stringify(record),
          strOrNull(record.status),
          updatedAt,
        ]
      )
    );
  }
}

// ─── 惰性单例（按 DB 路径键控：测试切换隔离目录时自动重建并释放旧连接） ───

let store: PdcaCheckpointStore | null = null;
let storePath: string | null = null;

function getStore(): PdcaCheckpointStore {
  const path = resolveDbPath();
  if (store && storePath === path) return store;
  if (store) store.close();
  store = new PdcaCheckpointStore(path);
  storePath = path;
  return store;
}

/** 关闭并重置单例（供测试隔离/清理前调用；生产不调用） */
export function closePdcaCheckpointStore(): void {
  const current = store;
  store = null;
  storePath = null;
  if (current) current.close();
}

/** 读取 PDCA 检查点 */
export function readPdcaCheckpoint(
  taskId: string
): Promise<Record<string, unknown> | null> {
  return getStore().readCheckpoint(taskId);
}

/**
 * 写入 PDCA 检查点。
 *
 * Gap D（1-0a，2026-09-03）：合并式写模型。原实现整文件覆盖会把
 * workItemId/status/workspaceId/projectId/lastPdcaPhase 等归属字段整体抹掉。
 * GAI-3（2026-10-05）：改为 DB 内**原子合并写**（消除 RMW 竞态）。
 */
export function writePdcaCheckpoint(
  taskId: string,
  data: Record<string, unknown>
): Promise<void> {
  return getStore().writeCheckpoint(taskId, data);
}

/** P0(M9)：列出全部 PDCA checkpoint（含终态与非终态，供 /goal list 过滤） */
export function listPdcaCheckpoints(): Promise<Array<Record<string, unknown>>> {
  return getStore().listCheckpoints();
}

/**
 * 检查点**索引**（taskId → 检查点）—— 供 HTTP 层按 taskId 回填归属字段。
 */
export function getPdcaCheckpointIndex(): Promise<
  Map<string, Record<string, unknown>>
> {
  return getStore().checkpointIndex();
}

/** 写入 PDCA WorkItem（`pdca-handlers.handlePdcaStart` 创建关联工作项） */
export function writePdcaWorkItem(
  record: Record<string, unknown>
): Promise<void> {
  return getStore().writeWorkItem(record);
}

/**
 * 检查点**终态 status** 集合（2026-09-29，另案 ⑥ 留存）。
 *
 * 与 [`pdca-handlers.findExistingTask`](../infrastructure/http/handlers/pdca-handlers.ts) 的
 * "非活跃"判据**同源** ⇒ 收敛为单一事实源（GR02），并与 `core` 的 `PDCA_TERMINAL_PHASES`
 * （按 **phase** 判定）互为补充：本仓检查点**两个字段并用** ⇒ 二者任一为终态即算终态。
 */
export const PDCA_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'abort',
]);

/**
 * **活跃 status**（2026-09-29，另案 ⑥ 留存扩展）：这些状态视为"正在跑"，留存**一律保留**。
 */
export const PDCA_ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  'started',
  'running',
]);

/**
 * **待审批 phase**（同批）：等待用户/审批入口处理，留存**一律保留**。
 */
export const PDCA_AWAITING_APPROVAL_PHASES: ReadonlySet<string> = new Set([
  'plan_pending',
  'stage_awaiting_approval',
]);

/**
 * 检查点留存天数（2026-09-29，另案 ⑥ · 留存策略）。
 *
 * **可删条件 = 超期 且 下列任一**：
 * 1. **终态**：`phase ∈ PDCA_TERMINAL_PHASES` **或** `status ∈ PDCA_TERMINAL_STATUSES`；
 * 2. **孤儿**：非终态 **且** `status ∉ PDCA_ACTIVE_STATUSES`
 *    **且** `phase ∉ PDCA_AWAITING_APPROVAL_PHASES`。
 *
 * **一律保留**：`started`/`running`（可能在跑）、`plan_pending`/`stage_awaiting_approval`（待审批）、
 * 以及**未超期**的一切。超期判据：`updated_at` 早于 `now - 天数`。
 */
export const PDCA_CHECKPOINT_RETENTION_DAYS = 30;

/** 留存清理结果（供日志与测试断言） */
export interface PdcaCheckpointPruneResult {
  /** 扫描到的检查点数 */
  scanned: number;
  /** 已删除总数（= prunedTerminal + prunedOrphan） */
  pruned: number;
  /** 其中：终态超期 */
  prunedTerminal: number;
  /** 其中：超期孤儿（非终态且非活跃、非待审批） */
  prunedOrphan: number;
  /** 保留：未超期 */
  keptFresh: number;
  /** 保留：未超期以外的不可删项（非终态且活跃/待审批，或无 taskId） */
  keptActive: number;
  /** 删除失败数 */
  errors: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * **留存清理**：删除"终态/孤儿 + 超期"的检查点（2026-09-29，另案 ⑥ 留存策略）。
 *
 * **调用时机**：DAEMON/CLI 启动时一次（`main.ts` 的启动链，**在启动扫描之后**）。
 *
 * @param maxAgeDays 保留天数（默认 {@link PDCA_CHECKPOINT_RETENTION_DAYS}）
 */
export function prunePdcaCheckpoints(
  maxAgeDays: number = PDCA_CHECKPOINT_RETENTION_DAYS
): Promise<PdcaCheckpointPruneResult> {
  return getStore().prune(maxAgeDays);
}

/** 检查点一次性迁移结果 */
export interface PdcaCheckpointMigrationResult {
  /** 成功导入数 */
  imported: number;
  /** 表中已存在而跳过数 */
  skipped: number;
  /** 失败数（仅 warn，不抛出） */
  errors: number;
}

/**
 * **一次性、幂等迁移**：把 `<dir>/*.json` 中"表中不存在该 task_id"的检查点导入 DB。
 *
 * - **幂等**：已存在的 task_id 一律跳过（重复调用不重复导入）；
 * - **不删原 JSON**（可回滚、安全）；
 * - **失败不抛出**：逐文件 warn + 计数，不阻断启动。
 *
 * @param dir 检查点目录（默认 `~/.pyapp/data/pdca/`）
 */
export async function migratePdcaCheckpointsFromJson(
  dir: string = resolveDataSubDir('pdca')
): Promise<PdcaCheckpointMigrationResult> {
  const result: PdcaCheckpointMigrationResult = {
    imported: 0,
    skipped: 0,
    errors: 0,
  };
  if (!existsSync(dir)) return result;

  let names: string[];
  try {
    names = readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch (err) {
    logger.warn('PDCA 检查点迁移：目录读取失败（跳过迁移）', {
      dir,
      error: err instanceof Error ? err.message : String(err),
    });
    return result;
  }

  const s = getStore();
  for (const name of names) {
    const taskId = name.slice(0, -'.json'.length);
    if (!taskId) continue;
    try {
      const full = join(dir, name);
      const parsed = JSON.parse(readFileSync(full, 'utf-8')) as Record<
        string,
        unknown
      >;
      if (!parsed || typeof parsed !== 'object') {
        result.errors++;
        continue;
      }
      // updated_at：优先 JSON.updatedAt（ISO），否则回退文件 mtime（对齐原留存判据）；
      // 二者皆无 ⇒ 视为 fresh（now），与旧实现"无时间戳即保留"一致。
      const updatedAt =
        parseTimestampMs(parsed.updatedAt) !== null
          ? (parsed.updatedAt as string)
          : (fileMtimeIso(full) ?? new Date().toISOString());
      const imported = await s.importCheckpoint(taskId, parsed, updatedAt);
      if (imported) result.imported++;
      else result.skipped++;
    } catch (err) {
      result.errors++;
      logger.warn('PDCA 检查点迁移失败（跳过该文件）', {
        file: name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (result.imported > 0 || result.errors > 0) {
    logger.info('PDCA 检查点迁移完成', { dir, ...result });
  }
  return result;
}

/**
 * 同步 PDCA 阶段 → WorkItem 状态
 *
 * @param taskId PDCA 任务 ID
 * @param pdcaPhase 当前 PDCA 阶段
 */
export async function syncPdcaWorkItemStatus(
  taskId: string,
  pdcaPhase: PdcaPhase
): Promise<void> {
  const ck = await readPdcaCheckpoint(taskId);
  if (!ck?.workItemId) return;

  const workItemId = ck.workItemId as string;
  const s = getStore();
  const wi = await s.readWorkItem(workItemId);
  if (!wi) return;

  const newStatus = PDCA_TO_WORKITEM[pdcaPhase] || 'running';
  if (wi.status === newStatus) return;

  wi.status = newStatus;
  wi.updatedAt = new Date().toISOString();
  if (newStatus === 'done' || newStatus === 'failed') {
    wi.completedAt = new Date().toISOString();
  }
  await s.writeWorkItem(wi);

  // 更新检查点中的阶段信息
  await writePdcaCheckpoint(taskId, { ...ck, lastPdcaPhase: pdcaPhase });
}
