// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * TaskGoalStore —— 长程任务**目标**一等公民的持久化（M-6，2026-09-22）
 *
 * 为什么需要：长程任务当前**没有"目标"实体** ——
 * 编排层的 `goal` 只是 `AgentSwarm` 的一次性入参（黑板文本），会话侧只有
 * `turn` / yield 等待 / `agent_runs` 台账，**没有任何持久化实体回答**
 * "这批工作要达成什么、现在到哪一步、为何停下"。停下原因无法一等表达：
 * `completed` / `blocked` / `budget_limited` / `failed` / `cancelled` 中，
 * 只有前两者能从既有台账推断。
 *
 * 设计口径（`.trae/specs/long-horizon-goal-entity.md` §3）：
 * - D2：**6 态** + **终态不可改写**（沿用本方案 I4 单向状态机不变量）；
 * - D3：`tokens_used` **累加写**（不做全量重算，避免双写）；
 * - D4：本类**只做持久化 + 状态机**，不含续接调度 / 预算熔断（属 M-7 / M-8）。
 *
 * 存储：唯一 `app.db`（`resolveDbPath()`），表 `task_goals`；**不新建库文件**（§1.5）。
 */

import { randomUUID } from 'crypto';
import { Database } from '@modules/core/external/sqlite3';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('tasks:goal:store');

export const TASK_GOALS_TABLE = 'task_goals';

/**
 * 目标状态（6 态）。
 *
 * - `active`：推进中（唯一的"可推进"状态）；
 * - `blocked`：受阻（**非终态** —— 允许 `blocked → active` 恢复，对齐 codex 的 `GOAL_RESUMED`）；
 * - `completed` / `budget_limited` / `failed` / `cancelled`：**终态**，落定后不可改写。
 */
export type TaskGoalStatus =
  | 'active'
  | 'blocked'
  | 'completed'
  | 'budget_limited'
  | 'failed'
  | 'cancelled';

/** 终态集合（落定后**不可改写**） */
export const TASK_GOAL_TERMINAL_STATUSES: ReadonlySet<TaskGoalStatus> = new Set(
  ['completed', 'budget_limited', 'failed', 'cancelled']
);

/** 是否为终态 */
export function isTerminalGoalStatus(status: TaskGoalStatus): boolean {
  return TASK_GOAL_TERMINAL_STATUSES.has(status);
}

/**
 * 目标状态机（显式化，避免"隐含在若干 if 里"）。
 *
 * ```
 *            create()
 *               │
 *               ▼
 *          ┌ active ┐ ⇄ ┌ blocked ┐     （blocked 可恢复 ⇒ 非终态）
 *          └───┬────┘   └────┬─────┘
 *              │             │
 *              ▼             ▼
 *    ┌──────────── 终态（不可改写）────────────┐
 *    │ completed / budget_limited / failed / cancelled │
 *    └──────────────────────────────────────────────┘
 * ```
 *
 * **合法迁移**：`active → {blocked|completed|budget_limited|failed|cancelled}`、
 * `blocked → {active|completed|budget_limited|failed|cancelled}`。
 * **非法迁移**：终态 → 任何；同态自迁移；`active → active`。
 */
export function canTransitionGoal(
  from: TaskGoalStatus,
  to: TaskGoalStatus
): boolean {
  if (from === to) return false;
  if (isTerminalGoalStatus(from)) return false;
  if (to === 'active') return from === 'blocked'; // 仅"受阻"可恢复
  return true; // → blocked | completed | budget_limited | failed | cancelled
}

/** 目标实体（域类型） */
export interface TaskGoal {
  id: string;
  /** 归属会话（长程任务通常挂在一个会话上） */
  sessionId?: string;
  /** 目标陈述（"要达成什么"——唯一的人类可读锚点） */
  objective: string;
  status: TaskGoalStatus;
  /** 任务级 token 预算（缺省 = 不限） */
  tokenBudget?: number;
  /** 已消耗 token（累加写） */
  tokensUsed: number;
  /**
   * **连续未达成批次数**（停止条件的计数据，2026-09-22）。
   *
   * 语义：每次批次收口只落到"部分成功"（`blocked`）时 +1；本类**只记数，不判策略**
   *（"达阈值 ⇒ 停止"属策略层 `goalRunBinding`，见 spec §3 D4）。
   */
  noProgressStreak: number;
  createdAt: number;
  updatedAt: number;
}

export class TaskGoalStore {
  private db: Database | null = null;
  private dbPath?: string;
  private initPromise: Promise<void> | null = null;

  /** @param dbPath 显式库路径（测试用）；缺省由 `init()` 惰性解析 `resolveDbPath()` */
  constructor(dbPath?: string) {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    if (this.db) return;
    if (!this.initPromise) {
      this.initPromise = this.doInit();
    }
    try {
      await this.initPromise;
    } catch (err) {
      // 与 SettlementOutbox / YieldWaitingStore 同法：失败必须清空，否则一次瞬时故障永久失效
      this.initPromise = null;
      throw err;
    }
  }

  private async doInit(): Promise<void> {
    const dbPath =
      this.dbPath ?? (await import('@modules/core')).resolveDbPath();
    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(dbPath, (err: Error | null) =>
        err ? reject(err) : resolve(db)
      );
    });
    await this.run(
      `CREATE TABLE IF NOT EXISTS ${TASK_GOALS_TABLE} (
        id                 TEXT PRIMARY KEY,
        session_id         TEXT,
        objective          TEXT NOT NULL,
        status             TEXT NOT NULL,
        token_budget       INTEGER,
        tokens_used        INTEGER NOT NULL DEFAULT 0,
        no_progress_streak INTEGER NOT NULL DEFAULT 0,
        created_at         INTEGER NOT NULL,
        updated_at         INTEGER NOT NULL
      )`
    );
    // **增量加列**（2026-09-22，连续无进展停止条件）：已建表的库没有该列。
    // SQLite 无 `ADD COLUMN IF NOT EXISTS` ⇒ 列已存在时 ALTER 报错，属预期。
    // 既有同款约定见 `UsageStatsService.ts:236-243`（用 try 忽略）。
    try {
      await this.run(
        `ALTER TABLE ${TASK_GOALS_TABLE}
           ADD COLUMN no_progress_streak INTEGER NOT NULL DEFAULT 0`
      );
    } catch {
      // @ignore-catch — 列已存在（SQLite 不支持 ALTER TABLE ADD COLUMN IF NOT EXISTS）
    }
    await this.run(
      `CREATE INDEX IF NOT EXISTS idx_task_goals_status
       ON ${TASK_GOALS_TABLE} (status, created_at)`
    );
  }

  /** 创建目标（新目标恒从 `active` 起步；`tokensUsed` 从 0 开始） */
  async create(params: {
    objective: string;
    sessionId?: string;
    tokenBudget?: number;
    id?: string;
    now?: number;
  }): Promise<TaskGoal> {
    await this.init();
    const now = params.now ?? Date.now();
    const goal: TaskGoal = {
      id: params.id ?? `goal-${randomUUID().replace(/-/g, '').slice(0, 8)}`,
      sessionId: params.sessionId,
      objective: params.objective,
      status: 'active',
      tokenBudget: params.tokenBudget,
      tokensUsed: 0,
      noProgressStreak: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.run(
      `INSERT INTO ${TASK_GOALS_TABLE}
         (id, session_id, objective, status, token_budget, tokens_used, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        goal.id,
        goal.sessionId ?? null,
        goal.objective,
        goal.status,
        goal.tokenBudget ?? null,
        goal.tokensUsed,
        goal.createdAt,
        goal.updatedAt,
      ]
    );
    return goal;
  }

  /** 取单个目标（不存在 ⇒ null） */
  async get(id: string): Promise<TaskGoal | null> {
    await this.init();
    const row = await this.get1<Record<string, unknown>>(
      `SELECT * FROM ${TASK_GOALS_TABLE} WHERE id = ?`,
      [id]
    );
    return row ? TaskGoalStore.toGoal(row) : null;
  }

  /** 列某会话的全部目标（按创建时间升序） */
  async listBySession(sessionId: string): Promise<TaskGoal[]> {
    await this.init();
    const rows = await this.all<Record<string, unknown>>(
      `SELECT * FROM ${TASK_GOALS_TABLE} WHERE session_id = ? ORDER BY created_at ASC`,
      [sessionId]
    );
    return rows.map(TaskGoalStore.toGoal);
  }

  /**
   * 列**未终结**目标（`active` / `blocked`）。
   * @param sessionId 省略 ⇒ 全库（长驻进程启动时用于恢复视角）
   */
  async listActive(sessionId?: string): Promise<TaskGoal[]> {
    await this.init();
    const rows = sessionId
      ? await this.all<Record<string, unknown>>(
          `SELECT * FROM ${TASK_GOALS_TABLE}
             WHERE session_id = ? AND status IN ('active', 'blocked')
             ORDER BY created_at ASC`,
          [sessionId]
        )
      : await this.all<Record<string, unknown>>(
          `SELECT * FROM ${TASK_GOALS_TABLE}
             WHERE status IN ('active', 'blocked')
             ORDER BY created_at ASC`
        );
    return rows.map(TaskGoalStore.toGoal);
  }

  /**
   * 迁移状态（**经状态机 + 终态守卫**，条件更新 + `changes` 判定）。
   *
   * @returns 是否真的发生迁移（false = 目标不存在 / 非法迁移 / 已是终态）
   */
  async updateStatus(id: string, to: TaskGoalStatus): Promise<boolean> {
    await this.init();
    const current = await this.get(id);
    if (!current) return false;
    if (!canTransitionGoal(current.status, to)) {
      logger.debug('目标状态未迁移：非法迁移', {
        id,
        from: current.status,
        to,
      });
      return false;
    }
    const changed = await this.run(
      `UPDATE ${TASK_GOALS_TABLE} SET status = ?, updated_at = ?
         WHERE id = ? AND status = ?`,
      [to, Date.now(), id, current.status]
    );
    if (changed === 0) {
      // 并发下被他人先迁移（条件更新未命中）⇒ 不覆盖
      logger.debug('目标状态未迁移：并发条件更新未命中', {
        id,
        from: current.status,
        to,
      });
      return false;
    }
    return true;
  }

  /**
   * 累加 token 用量（D3：累加写，不做全量重算）。
   *
   * @returns 累加后的 `tokensUsed`（目标不存在 ⇒ null；`tokens` 非正/非有限 ⇒ 原值）
   */
  async addUsage(id: string, tokens: number): Promise<number | null> {
    await this.init();
    if (!Number.isFinite(tokens) || tokens <= 0) {
      return (await this.get(id))?.tokensUsed ?? null;
    }
    const changed = await this.run(
      `UPDATE ${TASK_GOALS_TABLE}
         SET tokens_used = tokens_used + ?, updated_at = ?
       WHERE id = ?`,
      [Math.floor(tokens), Date.now(), id]
    );
    if (changed === 0) return null;
    return (await this.get(id))?.tokensUsed ?? null;
  }

  /**
   * 是否已触顶（`token_budget` 已设且 `tokens_used >= token_budget`）。
   *
   * 说明：本方法**只回答事实**，不落状态 —— "触顶 ⇒ 落 `budget_limited` + 收尾"
   * 属 M-8（策略层），见 spec §3 D4/D6。
   */
  async isBudgetExceeded(id: string): Promise<boolean> {
    const goal = await this.get(id);
    if (!goal || goal.tokenBudget === undefined) return false;
    return goal.tokensUsed >= goal.tokenBudget;
  }

  /**
   * **连续未达成批次数 +1**（2026-09-22，停止条件的计数据）。
   *
   * 条件更新：**终态目标不再计数**（`changes === 0` ⇒ 返回 `null`）——
   * 与状态机"终态不可改写"同源，避免给已停止的目标继续累加。
   * 终态集合直接取自 `TASK_GOAL_TERMINAL_STATUSES`（不在此重复列举）。
   *
   * @returns 递增后的值；目标不存在 / 已是终态 ⇒ `null`
   */
  async bumpNoProgressStreak(id: string): Promise<number | null> {
    await this.init();
    const terminal = [...TASK_GOAL_TERMINAL_STATUSES];
    const placeholders = terminal.map(() => '?').join(', ');
    const changed = await this.run(
      `UPDATE ${TASK_GOALS_TABLE}
         SET no_progress_streak = no_progress_streak + 1, updated_at = ?
       WHERE id = ? AND status NOT IN (${placeholders})`,
      [Date.now(), id, ...terminal]
    );
    if (changed === 0) return null;
    return (await this.get(id))?.noProgressStreak ?? null;
  }

  /** 删除目标（物理删除；仅测试与显式清理使用，长程任务应走终态而非删除） */
  async remove(id: string): Promise<boolean> {
    await this.init();
    const changed = await this.run(
      `DELETE FROM ${TASK_GOALS_TABLE} WHERE id = ?`,
      [id]
    );
    return changed > 0;
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
    }
  }

  // ==================== 内部：sqlite 封装 ====================

  private run(sql: string, params: unknown[] = []): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');
    return new Promise<number>((resolve, reject) => {
      this.db!.run(
        sql,
        params,
        function (this: { changes?: number }, err: Error | null) {
          if (err) reject(err);
          else resolve(this.changes ?? 0);
        }
      );
    });
  }

  private get1<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    if (!this.db) throw new Error('Database not initialized');
    return new Promise<T | null>((resolve, reject) => {
      this.db!.get(sql, params, (err: Error | null, row: T | undefined) =>
        err ? reject(err) : resolve(row ?? null)
      );
    });
  }

  private all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (!this.db) throw new Error('Database not initialized');
    return new Promise<T[]>((resolve, reject) => {
      this.db!.all(sql, params, (err: Error | null, rows: T[] | undefined) =>
        err ? reject(err) : resolve(rows ?? [])
      );
    });
  }

  private static toGoal(raw: Record<string, unknown>): TaskGoal {
    const budget = raw['token_budget'];
    return {
      id: String(raw['id']),
      sessionId:
        raw['session_id'] === null || raw['session_id'] === undefined
          ? undefined
          : String(raw['session_id']),
      objective: String(raw['objective'] ?? ''),
      status: String(raw['status'] ?? 'active') as TaskGoalStatus,
      tokenBudget:
        budget === null || budget === undefined ? undefined : Number(budget),
      tokensUsed: Number(raw['tokens_used'] ?? 0),
      // 增量加列的库在 ALTER 前的老行 ⇒ 该列为 NULL，按 0 处理
      noProgressStreak: Number(raw['no_progress_streak'] ?? 0),
      createdAt: Number(raw['created_at'] ?? 0),
      updatedAt: Number(raw['updated_at'] ?? 0),
    };
  }
}

let instance: TaskGoalStore | null = null;

/** 全局单例（惰性：首次使用才解析 DB 路径并建表） */
export function getTaskGoalStore(): TaskGoalStore {
  if (!instance) {
    instance = new TaskGoalStore();
  }
  return instance;
}

/**
 * **仅测试使用**：替换/清空全局单例 —— 让 HTTP 路由等"经单例取 store"的代码
 * 可在临时库上被测试，而**不写入真实 `app.db`**（与 `resetAgentRunLedger()` 同法）。
 *
 * 生产路径不得调用。
 */
export function setTaskGoalStoreForTest(store: TaskGoalStore | null): void {
  instance = store;
}
