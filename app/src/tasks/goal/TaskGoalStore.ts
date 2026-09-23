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

/**
 * **状态迁移 / 字段变更的原因码**（B2-2，2026-09-23）。
 *
 * 用途：事件载荷 `goal/status_changed.reason` 与 `goal/updated.reason` 的**机器可读**面
 * ——"为何停下"的唯一答案（`.trae/specs/goal-entity.md` §4.1）。
 * 判定一律用本枚举，**禁止**按 `objective` 文案或用户可见字符串推断（CS02）。
 *
 * 取值说明（Spec §3.2 的枚举 + 本仓实际落定路径补齐的两条）：
 * - `batch_completed` / `batch_blocked` / `budget_limit` / `stop_threshold`：Spec 原文；
 * - `batch_failed` / `batch_cancelled`：**本仓补齐** —— 批次全败与批次取消也是真实落定路径，
 *   Spec 枚举未列（若不补，这两条路径只能落 `null` 原因，与"唯一答案"目标相悖）；
 * - `turn_error` / `compaction_stalled` / `manual`：属缺口 X9 / X10 / X4（本批未接，
 *   先按 Spec 登记词表，待其落地后由对应策略层产出）。
 */
export type TaskGoalUpdateReason =
  | 'batch_completed'
  | 'batch_blocked'
  | 'batch_failed'
  | 'batch_cancelled'
  | 'budget_limit'
  | 'stop_threshold'
  | 'turn_error'
  | 'compaction_stalled'
  // 二期 N2（2026-09-23 修复计划 §六）：**只记录、不计数**的"这一轮为何停下"原因码。
  // 语义上都不是"无进展" ⇒ 不得混入 `no_progress_streak`（`user_aborted` 更不得
  // 按用户意图相反地触发 idle 续接）。
  | 'turn_limit'
  | 'turn_timeout'
  | 'turn_budget_exhausted'
  | 'turn_interrupted'
  | 'user_aborted'
  | 'manual';

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
  /**
   * 最近一次归属批次的 `agent_runs` 行 id（`Goal ↔ agent_runs` 关联键，B2-4 / X6）。
   *
   * 口径：`agent_runs.tool_call_id`（该表主键，`AgentRunStore.ts:209`）；批次自身那行由
   * `AgentTool.beginRun()` 以 `toolCallId = agentId` 写入 ⇒ 值为**批次 run id**。
   * 未接（无批次 / 未提供）⇒ `undefined`。
   */
  runId?: string;
  /**
   * **最近一次状态迁移的原因码**（B2-2；"为何停下"的机器可读面，Spec §3.2）。
   *
   * 只由 `markStatusChanged`（经策略层）写入；旧库经增量加列后为 `NULL` ⇒ `undefined`
   * （表示"该行落定于本次能力之前"，**不臆造**原因码）。
   */
  updatedReason?: TaskGoalUpdateReason;
  /**
   * **预算触顶收尾的"已报告"时间戳**（X8，2026-09-23，Spec §5.5④）。
   *
   * 语义：`null`/`undefined` ⇒ 该目标的 `budget_limit` 收尾指令**尚未注入模型**；
   * 有值 ⇒ 已注入过一次（**跨进程/跨实例**都不得重复注入 —— 由
   * `claimBudgetLimitWrapUp` 的条件 UPDATE 保证）。
   * 对齐 codex `mark_budget_limit_reported_if_new`（`ext/goal/src/accounting.rs:484-491`）。
   */
  budgetLimitReportedAt?: number;
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
    // **增量加列**（2026-09-23，B2-4 / B2-2，Spec §3.2 —— 仅新增、**不删改既有列**）：
    // - `run_id`：归属批次（`agent_runs.tool_call_id`）关联键 ⇒ 目标可反查其批次行；
    // - `updated_reason`：状态迁移原因码 ⇒ "为何停下"的机器可读面。
    // 两者**可空**：旧行读到 `NULL` ⇒ 映射为 `undefined`（不得泄漏成 `NaN`/字符串 "null"）。
    for (const ddl of [
      `ALTER TABLE ${TASK_GOALS_TABLE} ADD COLUMN run_id TEXT`,
      `ALTER TABLE ${TASK_GOALS_TABLE} ADD COLUMN updated_reason TEXT`,
    ]) {
      try {
        await this.run(ddl);
      } catch {
        // @ignore-catch — 列已存在（SQLite 无 ADD COLUMN IF NOT EXISTS）
      }
    }
    await this.run(
      `CREATE INDEX IF NOT EXISTS idx_task_goals_status
       ON ${TASK_GOALS_TABLE} (status, created_at)`
    );
    // **增量加列**（2026-09-23，X8 / Spec §3.2 —— 仅新增、**不删改既有列**）：
    // `budget_limit_reported_at`：`budget_limit` 收尾指令的"已报告"时间戳 ⇒
    // 收尾**只注入一次**（跨进程由该列判定，不用内存 flag）。
    // 可空：旧行 / 未报告 ⇒ `NULL` ⇒ 映射为 `undefined`（不泄漏成 `NaN`）。
    try {
      await this.run(
        `ALTER TABLE ${TASK_GOALS_TABLE} ADD COLUMN budget_limit_reported_at INTEGER`
      );
    } catch {
      // @ignore-catch — 列已存在（SQLite 无 ADD COLUMN IF NOT EXISTS）
    }
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
    return this.markStatusChanged(id, to);
  }

  /**
   * 迁移状态**并落原因码**（B2-2，2026-09-23；Spec §9.1 S2 的 `markStatusChanged`）。
   *
   * 与 `updateStatus` 同一守卫链（`canTransitionGoal` + 条件更新 + `changes` 判定），
   * 差别只有一处：**同一条语句**写入 `updated_reason` —— 状态与"为何迁"不得分离落盘
   *（否则读端可能读到"新状态 + 旧原因"，即同一事实两个答案）。
   *
   * `reason` 省略 ⇒ 不动 `updated_reason` 列（保留既有值；兼容旧调用方）。
   *
   * @returns 是否真的发生迁移
   */
  async markStatusChanged(
    id: string,
    to: TaskGoalStatus,
    reason?: TaskGoalUpdateReason
  ): Promise<boolean> {
    await this.init();
    const current = await this.get(id);
    if (!current) return false;
    if (!canTransitionGoal(current.status, to)) {
      logger.debug('目标状态未迁移：非法迁移', {
        id,
        from: current.status,
        to,
        reason: reason ?? null,
      });
      return false;
    }
    const now = Date.now();
    const changed = reason
      ? await this.run(
          `UPDATE ${TASK_GOALS_TABLE}
             SET status = ?, updated_reason = ?, updated_at = ?
           WHERE id = ? AND status = ?`,
          [to, reason, now, id, current.status]
        )
      : await this.run(
          `UPDATE ${TASK_GOALS_TABLE} SET status = ?, updated_at = ?
             WHERE id = ? AND status = ?`,
          [to, now, id, current.status]
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
   * 记录**归属批次**（`agent_runs.tool_call_id`，B2-4 / X6）。
   *
   * 无状态过滤：批次收口时目标可能已是非终态任一（`active`/`blocked`）——
   * "最近一次归属批次"是**事实记录**，不参与状态机。
   *
   * @returns 是否写入（目标不存在 ⇒ false）
   */
  async setRunId(id: string, runId: string): Promise<boolean> {
    await this.init();
    const changed = await this.run(
      `UPDATE ${TASK_GOALS_TABLE} SET run_id = ?, updated_at = ?
         WHERE id = ?`,
      [runId, Date.now(), id]
    );
    return changed > 0;
  }

  /**
   * 更新**目标陈述 / 预算**（`PATCH /v1/goals/{id}` 的唯一写入口，B2-2 / X4）。
   *
   * **终态不可改写**：条件更新带 `status NOT IN (终态集合)` ⇒ 终态目标写不进去
   *（返回 `null`，路由据此回 **409**）。状态判定取自终态集合常量，**不按文案推断**（CS02）。
   *
   * @returns 更新后的目标；目标不存在 / 已是终态 ⇒ `null`
   */
  async updateFields(
    id: string,
    changes: { objective?: string; tokenBudget?: number },
    reason?: TaskGoalUpdateReason
  ): Promise<TaskGoal | null> {
    await this.init();
    const sets: string[] = [];
    const params: unknown[] = [];
    if (changes.objective !== undefined) {
      sets.push('objective = ?');
      params.push(changes.objective);
    }
    if (changes.tokenBudget !== undefined) {
      sets.push('token_budget = ?');
      params.push(changes.tokenBudget);
    }
    if (sets.length === 0) return this.get(id); // 无可写字段 ⇒ 只回读（不写 updated_at）
    if (reason !== undefined) {
      // 与 `markStatusChanged` 同口径：变更与"为何变更"**同一条语句**落盘
      //（`updated_reason = 'manual'` 是"下次续接改用 objective_updated"的判据，Spec §5.3.2）
      sets.push('updated_reason = ?');
      params.push(reason);
    }

    const terminal = [...TASK_GOAL_TERMINAL_STATUSES];
    sets.push('updated_at = ?');
    params.push(Date.now());
    const changed = await this.run(
      `UPDATE ${TASK_GOALS_TABLE} SET ${sets.join(', ')}
         WHERE id = ? AND status NOT IN (${terminal.map(() => '?').join(', ')})`,
      [...params, id, ...terminal]
    );
    if (changed === 0) return null;
    return this.get(id);
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
   * **原子记账 + 触顶晋升**（B2-5 / D4ⓑ，2026-09-23；对齐 codex `state/src/runtime/goals.rs:547-569`）。
   *
   * 相对旧"两步法"（`addUsage` → 策略层 `updateStatus`）的差别：
   * - 旧：**触顶判定**（策略层读 `tokensUsed >= tokenBudget`）与**状态写入**分处两条语句、
   *   两次读快照 ⇒ 两次之间任何并发写入（别的终态落定、并发记账）都能让两者**不一致**；
   * - 新：晋升的**判定条件写在 UPDATE 的 `WHERE`**（等价于 codex 的 `status = CASE WHEN
   *   <filter> AND token_budget IS NOT NULL AND tokens_used + <delta> >= token_budget THEN
   *   'budget_limited' ELSE status END`）⇒ 判定与写入**同一次求值**，且 `changes > 0`
   *   恰是"本次调用完成首次晋升"的**唯一判据**（并发下恰好一路命中）。
   *
   * **为什么不用字面 CASE 形式**（如实记录与 Spec §5.5① 的偏离）：
   * ① 字面 CASE 必须把 `tokens_used = tokens_used + ?` 并进**同一条**语句，而
   *    "触顶后仍记账"要求累加**无条件**发生 ⇒ 该语句的 `changes` 恒为 1，
   *    **无法**回答"本次是否首次晋升"（V5 的幂等判据会失真）；
   * ② 故实现为"无条件累加 + 带判定条件的守卫式晋升"，两条语句但**晋升本身是单条
   *    条件 UPDATE**（判定与写入原子），语义与 codex 的 CASE 形式在"非终态目标"上等价。
   *
   * **触顶后继续记账**（codex `goals.rs:516-530` 的 `ActiveOnly` 对位）：累加语句
   * **不带状态过滤** ⇒ `budget_limited` 之后 `tokensUsed` 仍如实增长。
   *
   * @returns `null` = 目标不存在 / 本次无可记账增量且目标已被删除；
   *   `promoted` = 本次调用把目标**首次**晋升为 `budget_limited`（幂等：重复调用恒 false）
   */
  async addUsageAndPromote(
    id: string,
    tokens: number
  ): Promise<{
    tokensUsed: number;
    tokenBudget?: number;
    promoted: boolean;
    /** 晋升发生时的**原状态**（仅 `promoted === true` 时有意义；由守卫式条件更新的观察值给出） */
    from?: TaskGoalStatus;
  } | null> {
    await this.init();
    const delta =
      Number.isFinite(tokens) && tokens > 0 ? Math.floor(tokens) : 0;
    // ① 无条件累加（含终态目标 —— "触顶后仍记账"）
    if (delta > 0) {
      await this.run(
        `UPDATE ${TASK_GOALS_TABLE}
           SET tokens_used = tokens_used + ?, updated_at = ?
         WHERE id = ?`,
        [delta, Date.now(), id]
      );
    }
    const current = await this.get(id);
    if (!current) return null;

    const budget = current.tokenBudget;
    if (
      budget === undefined ||
      current.tokensUsed < budget ||
      isTerminalGoalStatus(current.status)
    ) {
      return {
        tokensUsed: current.tokensUsed,
        tokenBudget: budget,
        promoted: false,
      };
    }

    // ② 守卫式**原子晋升**：判定条件在 WHERE 内 ⇒ 与本条状态写入同一次求值；
    //    条件为"**非终态**（`active`/`blocked`）且已触顶"—— 与 codex 的 `<filter>` 同义
    //（`goals.rs` 的 `ActiveOnly ⇒ status IN ('active','budget_limited')` 用于**记账**；
    //  晋升侧的 filter 即"可从之晋升的状态集"）。
    //    为何不锁"观察到的那个状态"：并发下另一路可能恰好把 `active` 改成 `blocked`
    //（`blocked` 同为非终态、且 `blocked → budget_limited` 合法）⇒ 锁死观察值会**丢掉晋升**
    //    并把"预算触顶"这个更高优先的结论让位给 `blocked`（终态优先级应相反）。
    //    `changes > 0` 恰是"本次调用完成首次晋升"的唯一判据（并发下恰好一路命中）。
    const promoted =
      (await this.run(
        `UPDATE ${TASK_GOALS_TABLE}
           SET status = 'budget_limited', updated_reason = 'budget_limit', updated_at = ?
         WHERE id = ? AND status IN ('active', 'blocked')
           AND token_budget IS NOT NULL AND tokens_used >= token_budget`,
        [Date.now(), id]
      )) > 0;
    if (!promoted) {
      // 并发下被他人先晋升 / 先落定终态 ⇒ 不覆盖（终态优先级），如实回读当前事实
      const after = await this.get(id);
      return {
        tokensUsed: after?.tokensUsed ?? current.tokensUsed,
        tokenBudget: after?.tokenBudget ?? budget,
        promoted: false,
      };
    }
    return {
      tokensUsed: current.tokensUsed,
      tokenBudget: budget,
      promoted: true,
      from: current.status,
    };
  }

  /**
   * **认领"预算触顶收尾"的唯一一次注入机会**（X8，2026-09-23；Spec §5.5④）。
   *
   * 对齐 codex `mark_budget_limit_reported_if_new`（`ext/goal/src/accounting.rs:484-491`）：
   * **单条条件 UPDATE + `changes` 判首次** —— `budget_limit_reported_at IS NULL` 是唯一
   * 前置条件，`changes > 0` 恰是"本次调用认领成功"（并发/跨进程下恰好一路命中）。
   *
   * **为什么不用 `listActive`**：`budget_limited` 是**终态**，被 `listActive` 按其定义
   * （`status IN ('active','blocked')`）排除；此处要取的是"已触顶但**尚未收尾报告**"的目标
   * ⇒ 在**同一 store** 内新增一条窄查询（复用本类 sqlite 封装，不另建查询模块，CS01）。
   *
   * @returns 认领成功 ⇒ 该目标（含记账/预算快照，供渲染收尾指令）；无待收尾目标
   *   或已被并发认领 ⇒ `null`
   */
  async claimBudgetLimitWrapUp(sessionId: string): Promise<TaskGoal | null> {
    await this.init();
    const candidate = await this.get1<Record<string, unknown>>(
      `SELECT id FROM ${TASK_GOALS_TABLE}
         WHERE session_id = ? AND status = 'budget_limited'
           AND budget_limit_reported_at IS NULL
         ORDER BY created_at ASC LIMIT 1`,
      [sessionId]
    );
    if (!candidate) return null;
    const id = String(candidate['id']);
    const now = Date.now();
    const claimed = await this.run(
      `UPDATE ${TASK_GOALS_TABLE}
         SET budget_limit_reported_at = ?, updated_at = ?
       WHERE id = ? AND budget_limit_reported_at IS NULL`,
      [now, now, id]
    );
    if (claimed === 0) return null; // 并发下被他人先认领 ⇒ 不重复报告
    return this.get(id);
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

  /**
   * 二期 N2（2026-09-23 修复计划 §六）：**只记录"这一轮为何停下"** —— 不改状态、不计数。
   *
   * 与 `markStatusChanged` 的分工：后者是"状态迁移 + 原因"（参与收口策略）；本方法只写
   * `updated_reason`（"为何停下"的机器可读面，Spec §3.2），**不推进 `no_progress_streak`、
   * 不改 status、不触发 idle 续接**。
   *
   * 为什么必须独立：`max_turns` / 超时 / 预算耗尽 / 普通错误 / **用户主动停止** 在语义上
   * 都不是"无进展"；混入 `no_progress_streak` 会让目标被误判为失败（3 次即终态），
   * `user_aborted` 更会按与用户意图**相反**的方向触发续接。
   *
   * 条件更新限定"未终结目标"（与 `bumpNoProgressStreak` 同口径）⇒ 终态目标不写、不谎报。
   *
   * @returns 是否真的写入（目标已终结 / 不存在 ⇒ false）
   */
  async recordTurnStopReason(
    id: string,
    reason: TaskGoalUpdateReason
  ): Promise<boolean> {
    await this.init();
    const terminal = [...TASK_GOAL_TERMINAL_STATUSES];
    const placeholders = terminal.map(() => '?').join(', ');
    const changed = await this.run(
      `UPDATE ${TASK_GOALS_TABLE}
         SET updated_reason = ?, updated_at = ?
       WHERE id = ? AND status NOT IN (${placeholders})`,
      [reason, Date.now(), id, ...terminal]
    );
    return changed > 0;
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
    const runId = raw['run_id'];
    const updatedReason = raw['updated_reason'];
    const budgetLimitReportedAt = raw['budget_limit_reported_at'];
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
      // 增量加列（2026-09-23）：旧行 / 未接 ⇒ NULL ⇒ `undefined`（不泄漏 "null" 字符串）
      runId:
        runId === null || runId === undefined || runId === ''
          ? undefined
          : String(runId),
      updatedReason:
        updatedReason === null ||
        updatedReason === undefined ||
        updatedReason === ''
          ? undefined
          : (String(updatedReason) as TaskGoalUpdateReason),
      // 增量加列（2026-09-23，X8）：旧行 / 未报告 ⇒ NULL ⇒ `undefined`（不泄漏成 NaN）
      budgetLimitReportedAt:
        budgetLimitReportedAt === null || budgetLimitReportedAt === undefined
          ? undefined
          : Number(budgetLimitReportedAt),
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
