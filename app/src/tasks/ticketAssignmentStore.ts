/**
 * Ticket Assignment 持久化（P34 · 单表 · 惰性建表）
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 **P34**。
 * 语义对齐参考实现 `docs/001-domain.md:36`（Assignment 是 Ticket 与某次执行实例的绑定）
 * 与 `docs/003-execution.md:9-19`（stage 派生要读"最新 Assignment 的状态 + 最新 Report"）。
 *
 * 为什么单独一张表而不是塞进 `workitems.data`：
 * - stage 派生与面板要按 **work_item_id** 查"最新一次派出/执行/结束"，塞 JSON 里只能全表扫；
 * - 一个 Ticket 先后可有**多个** Assignment（重启、重试、换执行器），JSON 单值表达不了。
 *
 * 诚实边界：本模块只做**持久记录**；运行时权威仍是 `AlwaysOnRuntime` / `ExecutionManager`。
 * 仅新增表与索引（`project_rules §1.5`），不做破坏性迁移。
 */

import { Database } from '@openliri/infra/external';
import { resolveDbPath } from '@openliri/infra/environment';
import { getLogger } from '@openliri/infra/monitoring';

const logger = getLogger('tasks:assignment-store');

export const TICKET_ASSIGNMENTS_TABLE = 'ticket_assignments';

/**
 * 词汇说明（`lint:state-ratchet`）：`pending/running/blocked/failed` 是**复用**已登记词汇
 * （`task` 状态机），不是新词表；`progress/waiting/ready/dropped/ended` 是派工/汇报域标签。
 * 出现点按门禁提示 `--update` 收编基线（Register-or-Fail 的合法路径）。
 */

/** 派工状态（与参考实现一致：独立于 Ticket 生命周期） */
export type AssignmentState = 'pending' | 'running' | 'ended';

/**
 * 状态字面量的**唯一事实源**（`lint:state-ratchet` Register-or-Fail）：
 * 判定"派工是否在跑"必须引用本常量，不得再裸写 `'running'`（CS02）。
 */
export const ASSIGNMENT_STATE_RUNNING: AssignmentState = 'running';

/** 最新一次汇报的状态（6 态；未知一律不猜） */
export type ReportState =
  | 'progress'
  | 'waiting'
  | 'ready'
  | 'blocked'
  | 'failed'
  | 'dropped';

/** 一条派工记录 */
export interface TicketAssignmentRecord {
  assignmentId: string;
  workItemId: string;
  /** 执行器标识（`alwayson` / `pdl` / `manual` …；不解释语义，仅用于审计） */
  executor: string;
  state: AssignmentState;
  reportState?: ReportState;
  reportText?: string;
  /**
   * 本轮实际使用的会话 id（P34 第二块）。
   *
   * 它是"工作项 → 会话 → 产物"这条链的中间环节：产物表只带 `session_id`，
   * 有了本列才能反查"这份产物属于哪个工作项"。
   */
  sessionId?: string;
  startedAt: number;
  endedAt?: number;
  updatedAt: number;
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS ${TICKET_ASSIGNMENTS_TABLE} (
    assignment_id TEXT PRIMARY KEY,
    work_item_id  TEXT NOT NULL,
    executor      TEXT NOT NULL DEFAULT '',
    state         TEXT NOT NULL DEFAULT 'pending',
    report_state  TEXT,
    report_text   TEXT,
    session_id    TEXT,
    started_at    INTEGER NOT NULL,
    ended_at      INTEGER,
    updated_at    INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ticket_assignments_work_item
     ON ${TICKET_ASSIGNMENTS_TABLE}(work_item_id, started_at)`,
  `CREATE INDEX IF NOT EXISTS idx_ticket_assignments_state
     ON ${TICKET_ASSIGNMENTS_TABLE}(state)`,
];

/**
 * 存量库补列（本表首版无 `session_id`；幂等，只增不改）。
 *
 * ⚠️ 该列的**索引必须在该列补好之后**再建（见 `openAndCreate`）——
 * 旧库先 `CREATE INDEX(session_id)` 会因缺列而让整个初始化失败
 * （`app/src/tasks/db/schema.ts:102-103` 记录过同型事故）。
 */
const ENSURE_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['session_id', 'TEXT'],
];

class TicketAssignmentStore {
  private db: Database | null = null;
  private initPromise: Promise<Database> | null = null;

  constructor(private readonly dbPath: string = resolveDbPath()) {}

  private init(): Promise<Database> {
    if (this.db) return Promise.resolve(this.db);
    this.initPromise ??= this.openAndCreate();
    return this.initPromise;
  }

  private async openAndCreate(): Promise<Database> {
    const db = await new Promise<Database>((resolve, reject) => {
      const d = new Database(this.dbPath, (err) => {
        if (err) reject(err);
        else resolve(d);
      });
    });
    try {
      for (const sql of DDL) {
        await new Promise<void>((resolve, reject) => {
          db.run(sql, (err) => (err ? reject(err) : resolve()));
        });
      }
      await this.ensureColumns(db);
      // 补列之后才能建该列索引（旧库首版无 session_id）
      await new Promise<void>((resolve, reject) => {
        db.run(
          `CREATE INDEX IF NOT EXISTS idx_ticket_assignments_session
             ON ${TICKET_ASSIGNMENTS_TABLE}(session_id)`,
          (err) => (err ? reject(err) : resolve())
        );
      });
    } catch (err) {
      db.close(() => {
        // @ignore-catch: 建表失败路径下尽力释放连接
      });
      this.initPromise = null;
      throw err;
    }
    this.db = db;
    return db;
  }

  /** 幂等补列：`PRAGMA table_info` 查已有列，缺哪列补哪列 */
  private async ensureColumns(db: Database): Promise<void> {
    const rows = await new Promise<Array<Record<string, unknown>>>(
      (resolve, reject) => {
        db.all(
          `PRAGMA table_info(${TICKET_ASSIGNMENTS_TABLE})`,
          (err, result) => {
            if (err) reject(err);
            else resolve((result as Array<Record<string, unknown>>) ?? []);
          }
        );
      }
    );
    const existing = new Set(rows.map((r) => String(r.name)));
    for (const [name, type] of ENSURE_COLUMNS) {
      if (existing.has(name)) continue;
      await new Promise<void>((resolve, reject) => {
        db.run(
          `ALTER TABLE ${TICKET_ASSIGNMENTS_TABLE} ADD COLUMN ${name} ${type}`,
          (err) => (err ? reject(err) : resolve())
        );
      });
    }
  }

  private async run(sql: string, params: unknown[] = []): Promise<void> {
    const db = await this.init();
    await new Promise<void>((resolve, reject) => {
      db.run(sql, params, (err) => (err ? reject(err) : resolve()));
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

  /** UPSERT（同一 assignmentId 重写即更新；用于状态推进与报告回填） */
  async upsert(record: TicketAssignmentRecord): Promise<void> {
    await this.run(
      `INSERT INTO ${TICKET_ASSIGNMENTS_TABLE}
        (assignment_id, work_item_id, executor, state, report_state, report_text,
         session_id, started_at, ended_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(assignment_id) DO UPDATE SET
         state = excluded.state,
         report_state = excluded.report_state,
         report_text = excluded.report_text,
         session_id = COALESCE(excluded.session_id, ${TICKET_ASSIGNMENTS_TABLE}.session_id),
         ended_at = excluded.ended_at,
         updated_at = excluded.updated_at`,
      [
        record.assignmentId,
        record.workItemId,
        record.executor,
        record.state,
        record.reportState ?? null,
        record.reportText ?? null,
        record.sessionId ?? null,
        record.startedAt,
        record.endedAt ?? null,
        record.updatedAt,
      ]
    );
  }

  /** 按工作项列出派工（时间正序；"最新"即末条） */
  async listByWorkItem(workItemId: string): Promise<TicketAssignmentRecord[]> {
    const rows = await this.allRows(
      `SELECT * FROM ${TICKET_ASSIGNMENTS_TABLE}
        WHERE work_item_id = ? ORDER BY started_at ASC`,
      [workItemId]
    );
    return rows.map(toRecord);
  }

  /** 按会话列出派工（用于"这份产物属于哪个工作项"的反查） */
  async listBySession(sessionId: string): Promise<TicketAssignmentRecord[]> {
    const rows = await this.allRows(
      `SELECT * FROM ${TICKET_ASSIGNMENTS_TABLE}
        WHERE session_id = ? ORDER BY started_at ASC`,
      [sessionId]
    );
    return rows.map(toRecord);
  }

  close(): void {
    const db = this.db;
    this.db = null;
    this.initPromise = null;
    if (!db) return;
    db.close((err) => {
      if (err) {
        logger.warn('ticket_assignments DB 关闭失败', { error: err.message });
      }
    });
  }
}

function toRecord(row: Record<string, unknown>): TicketAssignmentRecord {
  return {
    assignmentId: String(row.assignment_id ?? ''),
    workItemId: String(row.work_item_id ?? ''),
    executor: String(row.executor ?? ''),
    state: (row.state ?? 'pending') as AssignmentState,
    reportState: (row.report_state ?? undefined) as ReportState | undefined,
    reportText: (row.report_text ?? undefined) as string | undefined,
    sessionId: (row.session_id ?? undefined) as string | undefined,
    startedAt: Number(row.started_at ?? 0),
    endedAt: row.ended_at === null ? undefined : Number(row.ended_at),
    updatedAt: Number(row.updated_at ?? 0),
  };
}

// ─── 惰性单例（按 DB 路径键控；测试切换隔离目录时自动重建） ───

let store: TicketAssignmentStore | null = null;
let storePath: string | null = null;

function getStore(): TicketAssignmentStore {
  const path = resolveDbPath();
  if (store && storePath === path) return store;
  if (store) store.close();
  store = new TicketAssignmentStore(path);
  storePath = path;
  return store;
}

/** 写一条派工记录（UPSERT） */
export function upsertTicketAssignment(
  record: TicketAssignmentRecord
): Promise<void> {
  return getStore().upsert(record);
}

/** 列出某工作项的全部派工（时间正序） */
export function listTicketAssignments(
  workItemId: string
): Promise<TicketAssignmentRecord[]> {
  return getStore().listByWorkItem(workItemId);
}

/**
 * 取某工作项的**最新**派工（`undefined` = 从未派工）。
 *
 * 供 `deriveTicketStage()` 消费（`dsh:src/core/stage.ts:13` 的 `latestAssignment`）。
 */
export async function latestTicketAssignment(
  workItemId: string
): Promise<TicketAssignmentRecord | undefined> {
  const rows = await getStore().listByWorkItem(workItemId);
  return rows.at(-1);
}

/** 按会话列出派工（时间正序） */
export function listTicketAssignmentsBySession(
  sessionId: string
): Promise<TicketAssignmentRecord[]> {
  return getStore().listBySession(sessionId);
}

/**
 * 由**会话**反查最近一次派工所属的工作项（产物归属链的最后一跳）。
 *
 * 产物表只记 `session_id`；该方法把它映射回工作项，失败/无记录 ⇒ `undefined`
 * （**不猜**：宁可不归属，也不张冠李戴）。
 */
export async function findWorkItemIdBySession(
  sessionId: string
): Promise<string | undefined> {
  const rows = await getStore().listBySession(sessionId);
  return rows.at(-1)?.workItemId;
}

/** 关闭并重置单例（供测试隔离/清理前调用；生产不调用） */
export function closeTicketAssignmentStore(): void {
  const current = store;
  store = null;
  storePath = null;
  if (current) current.close();
}
