// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * AgentRunStore —— 子代理**运行态**持久化（方案 O6，B4）
 *
 * 解决的问题：内存台账（`AgentRunLedger`）随进程消失 ⇒ 崩溃/重启后"这条委派跑到哪了"
 * 无从回答；而**durable completion ≠ durable execution** —— 本表只保证
 * "**终态与归因**可查"，**不保证**崩溃后能续跑子代理（子代理在进程内执行，进程没了就没了）。
 *
 * 六要素落位：
 * ① `tool_call_id` 主键（幂等 upsert）；
 * ② 陈旧自愈：记录 `owner_pid` + `owner_started_at`（写入者身份），启动时对
 *    "非本进程所有 **且** 该 pid 已不存在"的行判 **`unknown`**（**不是 `error`** ——
 *    无法证明副作用是否发生，判 error 会让上层重试 ⇒ 副作用重复）；
 * ③ `schema_version` + **幂等 DDL** + `PRAGMA table_info` 驱动的 `ALTER TABLE ADD COLUMN`
 *    逐列补齐（仅新增字段，不改/删既有结构）；
 * ④ 投递态列（`delivery_state`/`delivery_attempts`）—— **由 O8（B5）消费**，本批只建列；
 * ⑤ 保留上限：终态保留最近 50 条 / 未终结保留 1000 条 / 且一律删除 7 天前的行；
 * ⑥ 批次内**逐任务**落盘：并行批次每个 worker 各自一行（`batch_id` + `task_key`），
 *    完成即写回 ⇒ 崩溃只丢"未完成的那几个"，而不是整批状态未知。
 *
 * 连接不泄漏：单例持有一个连接，`close()` 显式释放（与 `AgentRoleStore` 同法）。
 */

import { Database } from '@modules/core/external/sqlite3';
import { execFileSync } from 'child_process';
import { getLogger } from '@modules/monitoring';
import { resolveDbPath } from '@modules/core';

import type { AgentRunAttribution } from './runAttribution';

const logger = getLogger('tools:AgentTool:AgentRunStore');

/** 表名（对外暴露以便测试与巡检） */
export const AGENT_RUNS_TABLE = 'agent_runs';
/** 元数据表（存 schema_version） */
export const AGENT_RUNS_META_TABLE = 'agent_runs_meta';
/** 当前 schema 版本（③：升版时靠幂等 DDL/补列迁移，不删改既有结构） */
// v2（2026-09-21，O19）：新增 `descriptor_source`（描述符来源：role-store / registry / builtin / default）
// v3（2026-09-24，接线期③ ③-A）：新增 `attribution_json`（未完成 run 的失败归因：图快照 + 根因候选）
export const AGENT_RUNS_SCHEMA_VERSION = 3;

/** 保留上限（⑤） */
export const RETENTION_TERMINAL_MAX = 50;
export const RETENTION_ACTIVE_MAX = 1000;
export const RETENTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** 落盘状态：内存台账的三态 + **`unknown`**（陈旧自愈判定的"无法证明结果"态） */
export type PersistedRunStatus =
  | 'running'
  | 'cancel_requested'
  | 'completed'
  | 'failed'
  | 'unknown';

export interface AgentRunRecord {
  toolCallId: string;
  agentId: string;
  sessionId?: string;
  name: string;
  agentType: string;
  /** O19：描述符来源（`role-store` / `registry` / `builtin` / `default`；未知留空） */
  descriptorSource?: string;
  status: PersistedRunStatus;
  batchId?: string;
  taskKey?: string;
  outputSummary?: string;
  error?: string;
  ownerPid?: number;
  ownerStartedAt?: number;
  startedAt?: number;
  endedAt?: number;
}

export interface AgentRunRow extends AgentRunRecord {
  deliveryState: string;
  deliveryAttempts: number;
  /**
   * 接线期③ ③-A（2026-09-24）：**未完成 run** 的失败归因（系统图快照 + 根因候选）。
   * 完成态 / 无可归因对象时为 `undefined`（不写空结论）。
   */
  attribution?: AgentRunAttribution;
}

/** 写入者身份（②）：进程内稳定，用于区分"本进程的 run"与"上一个进程留下的 run" */
export interface OwnerIdentity {
  pid: number;
  startedAt: number;
}

/**
 * 取当前进程身份。
 *
 * `startedAt` 由 `process.uptime()` 反推（进程启动的绝对时间，**进程内恒定**）——
 * 与"只记 pid"相比，它把"pid 被操作系统复用"这一情形的判定依据**从外部进程
 * 转移到自身身份**：行里的 (pid, startedAt) 与当前进程不一致 ⇒ 该行不是本进程写的。
 */
export function currentOwnerIdentity(): OwnerIdentity {
  return {
    pid: process.pid,
    startedAt: Date.now() - Math.round(process.uptime() * 1000),
  };
}

/** 指定 pid 是否仍存在（`kill(pid, 0)`：只探测，不发送信号） */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = 不存在；EPERM = 存在但无权限（视为存活）
    return (err as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

/**
 * 进程启动时间比对容差（ms）。
 *
 * `owner_started_at` = `Date.now() - process.uptime()*1000`（本进程真实启动时刻，秒级取整），
 * 与 OS 查询值之间存在**取整/精度**差异（`uptime()` 秒级、`ps` 秒级、.NET ticks 亚毫秒）
 * ⇒ 留 5s 余量，只用于区分"启动时刻相差悬殊"的 PID 复用场景。
 */
export const PROCESS_START_TOLERANCE_MS = 5000;

/**
 * 读取指定 pid 的**真实启动时间**（ms epoch）；不可得 ⇒ `null`（调用方保守处理）。
 *
 * 用途（O6② 平台局限修复）：`isPidAlive()` 只能证明"该 pid 被占用"，**无法区分**
 * "同一进程"与"PID 已被别的进程复用" ⇒ 原实现只能保守保留僵尸行（靠 7 天上限兜底）。
 * 配合写入时记录的 `owner_started_at`，即可判定"活着的是不是同一个进程"。
 *
 * 平台实现：Windows 走 PowerShell `Get-Process`（.NET ticks → epoch ms，一条命令拿数值，
 * 避免解析本地化日期）；POSIX 走 `ps -o lstart=`（`LC_ALL=C` 固定英文格式）。
 * 失败（进程已退出 / 权限不足 / 命令不可用）⇒ `null` ⇒ 调用方**保持保守行为**（fail-safe）。
 */
export function readProcessStartTime(pid: number): number | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    if (process.platform === 'win32') {
      const out = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          // .NET ticks(100ns, 0001-01-01 起) → epoch ms：ticks/10000 - 62135596800000
          `$p = Get-Process -Id ${pid} -ErrorAction Stop; ` +
            `[int64]($p.StartTime.ToUniversalTime().Ticks / 10000 - 62135596800000)`,
        ],
        { encoding: 'utf8', timeout: 10_000, windowsHide: true }
      ).trim();
      const ms = Number(out);
      return Number.isFinite(ms) && ms > 0 ? ms : null;
    }

    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, LC_ALL: 'C' },
    }).trim();
    if (!out) return null;
    const ms = new Date(out).getTime();
    return Number.isFinite(ms) ? ms : null;
  } catch {
    // @ignore-catch — 探测失败即"无法判定身份"，由调用方按保守策略处理（不是吞错）
    return null;
  }
}

export class AgentRunStore {
  private db: Database | null = null;
  private dbPath: string;
  private initPromise: Promise<void> | null = null;

  constructor(dbPath: string = resolveDbPath()) {
    this.dbPath = dbPath;
  }

  /** 初始化（幂等 + 并发安全）：建表 → 补列 → 写 schema_version → 陈旧自愈 → 保留裁剪 */
  async init(): Promise<void> {
    if (this.db) {
      return;
    }
    if (!this.initPromise) {
      this.initPromise = this.doInit();
    }
    await this.initPromise;
  }

  private async doInit(): Promise<void> {
    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err: Error | null) =>
        err ? reject(err) : resolve(db)
      );
    });

    await this.createTables();
    await this.ensureColumns();
    await this.ensureSchemaVersion();
    // ②：启动即自愈（旧进程留下的在途行 ⇒ unknown）
    const healed = await this.markStaleRunsUnknown();
    if (healed > 0) {
      logger.warn('子代理运行台账陈旧自愈：在途行判为 unknown', { healed });
    }
    const pruned = await this.prune();
    if (pruned > 0) {
      logger.info('子代理运行台账保留裁剪', { pruned });
    }
  }

  private async createTables(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.run(
      `CREATE TABLE IF NOT EXISTS ${AGENT_RUNS_TABLE} (
        tool_call_id      TEXT PRIMARY KEY,
        agent_id          TEXT NOT NULL,
        session_id        TEXT,
        name              TEXT NOT NULL,
        agent_type        TEXT NOT NULL,
        descriptor_source TEXT,
        status            TEXT NOT NULL,
        batch_id          TEXT,
        task_key          TEXT,
        output_summary    TEXT,
        error             TEXT,
        attribution_json  TEXT,
        owner_pid         INTEGER,
        owner_started_at  INTEGER,
        delivery_state    TEXT NOT NULL DEFAULT 'pending',
        delivery_attempts INTEGER NOT NULL DEFAULT 0,
        started_at        INTEGER NOT NULL,
        ended_at          INTEGER
      )`
    );
    await this.run(
      `CREATE TABLE IF NOT EXISTS ${AGENT_RUNS_META_TABLE} (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`
    );
  }

  /** ③ 逐列补齐既有库（幂等；仅新增字段） */
  private async ensureColumns(): Promise<void> {
    if (!this.db) return;
    const existing = await this.all<{ name: string }>(
      `PRAGMA table_info(${AGENT_RUNS_TABLE})`
    );
    const names = new Set(existing.map((r) => r.name));
    const additions: Array<[string, string]> = [
      ['batch_id', 'TEXT'],
      ['task_key', 'TEXT'],
      ['output_summary', 'TEXT'],
      ['owner_pid', 'INTEGER'],
      ['owner_started_at', 'INTEGER'],
      ['delivery_state', "TEXT NOT NULL DEFAULT 'pending'"],
      ['delivery_attempts', 'INTEGER NOT NULL DEFAULT 0'],
      // O19（v2）：描述符来源
      ['descriptor_source', 'TEXT'],
      // 接线期③ ③-A（v3）：失败归因（图快照 + 根因候选）
      ['attribution_json', 'TEXT'],
    ];
    for (const [column, ddl] of additions) {
      if (names.has(column)) continue;
      await this.run(
        `ALTER TABLE ${AGENT_RUNS_TABLE} ADD COLUMN ${column} ${ddl}`
      );
      logger.info('AgentRunStore 已补齐列', { column });
    }
  }

  /** ③ schema_version 落库（供后续升版判定） */
  private async ensureSchemaVersion(): Promise<void> {
    const row = await this.get<{ value: string }>(
      `SELECT value FROM ${AGENT_RUNS_META_TABLE} WHERE key = ?`,
      ['schema_version']
    );
    const stored = row ? Number(row.value) : Number.NaN;
    if (stored === AGENT_RUNS_SCHEMA_VERSION) return;
    await this.run(
      `INSERT INTO ${AGENT_RUNS_META_TABLE} (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ['schema_version', String(AGENT_RUNS_SCHEMA_VERSION)]
    );
    logger.info('AgentRunStore schema_version 已写入', {
      from: Number.isNaN(stored) ? null : stored,
      to: AGENT_RUNS_SCHEMA_VERSION,
    });
  }

  /**
   * ② 陈旧自愈：把"**非本进程所有** 且 记录中的 owner pid 已不存在"的在途行判为 `unknown`。
   *
   * 判据与语义（G2/G3）：
   * - **双条件** —— 先看身份是否本进程（pid + startedAt），再看 pid 是否存活；
   * - **判 `unknown` 而非 `error`** —— 无法证明副作用是否发生（子代理可能已改文件/已发请求），
   *   判 error 会诱导上层重试 ⇒ 副作用重复；
   * - **保守不误杀** —— pid 仍存活时不回收（可能是另一实例在跑；极端 pid 复用的僵尸行
   *   由 ⑤ 的 7 天保留上限兜底），并在日志中留痕。
   *
   * @returns 被判为 unknown 的行数
   */
  async markStaleRunsUnknown(): Promise<number> {
    const me = currentOwnerIdentity();
    const rows = await this.all<{
      tool_call_id: string;
      owner_pid: number | null;
      owner_started_at: number | null;
      status: string;
    }>(
      `SELECT tool_call_id, owner_pid, owner_started_at, status FROM ${AGENT_RUNS_TABLE}
       WHERE status IN ('running', 'cancel_requested')`
    );

    let healed = 0;
    for (const row of rows) {
      const isMine =
        row.owner_pid === me.pid && row.owner_started_at === me.startedAt;
      if (isMine) continue;

      if (row.owner_pid !== null && isPidAlive(row.owner_pid)) {
        // O6②（v7.1）：**PID 存活 ≠ 同一进程** —— 用"真实启动时间"排除 PID 复用。
        // 判定：能读到活进程启动时间、且与记录值相差超过容差 ⇒ 该 pid 已被别的进程占用
        // ⇒ 原 owner 已死 ⇒ 该行陈旧（继续往下判 unknown）。
        // 读不到（权限/平台不支持）⇒ 保持原保守行为（fail-safe，不误回收在途 run）。
        const liveStart = readProcessStartTime(row.owner_pid);
        const recordedStart = row.owner_started_at;
        const pidReused =
          liveStart !== null &&
          recordedStart !== null &&
          Math.abs(liveStart - recordedStart) > PROCESS_START_TOLERANCE_MS;

        if (!pidReused) {
          logger.warn(
            '运行台账存在他进程所有的在途行（保守保留，不判 unknown）',
            {
              toolCallId: row.tool_call_id,
              ownerPid: row.owner_pid,
              status: row.status,
              liveStart,
              recordedStart,
            }
          );
          continue;
        }
        logger.warn('运行台账发现 PID 复用（启动时间不符）⇒ 该行判为陈旧', {
          toolCallId: row.tool_call_id,
          ownerPid: row.owner_pid,
          liveStart,
          recordedStart,
        });
      }

      await this.run(
        `UPDATE ${AGENT_RUNS_TABLE}
         SET status = 'unknown', ended_at = ?
         WHERE tool_call_id = ? AND status IN ('running', 'cancel_requested')`,
        [Date.now(), row.tool_call_id]
      );
      healed++;
    }
    return healed;
  }

  /** ⑤ 保留裁剪：终态最近 50 / 在途 1000 / 一律删除 7 天前 */
  async prune(now = Date.now()): Promise<number> {
    let removed = 0;
    removed += await this.run(
      `DELETE FROM ${AGENT_RUNS_TABLE} WHERE started_at < ?`,
      [now - RETENTION_MAX_AGE_MS]
    );
    removed += await this.run(
      `DELETE FROM ${AGENT_RUNS_TABLE}
       WHERE status IN ('completed', 'failed', 'unknown')
         AND tool_call_id NOT IN (
           SELECT tool_call_id FROM ${AGENT_RUNS_TABLE}
           WHERE status IN ('completed', 'failed', 'unknown')
           ORDER BY COALESCE(ended_at, started_at) DESC LIMIT ?
         )`,
      [RETENTION_TERMINAL_MAX]
    );
    removed += await this.run(
      `DELETE FROM ${AGENT_RUNS_TABLE}
       WHERE status NOT IN ('completed', 'failed', 'unknown')
         AND tool_call_id NOT IN (
           SELECT tool_call_id FROM ${AGENT_RUNS_TABLE}
           WHERE status NOT IN ('completed', 'failed', 'unknown')
           ORDER BY started_at DESC LIMIT ?
         )`,
      [RETENTION_ACTIVE_MAX]
    );
    return removed;
  }

  /** ① 起跑落盘（按 `tool_call_id` 幂等 upsert） */
  async startRun(record: AgentRunRecord): Promise<void> {
    await this.init();
    const me = currentOwnerIdentity();
    await this.run(
      `INSERT INTO ${AGENT_RUNS_TABLE}
        (tool_call_id, agent_id, session_id, name, agent_type, descriptor_source, status,
         batch_id, task_key, owner_pid, owner_started_at, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tool_call_id) DO UPDATE SET
         status = excluded.status,
         session_id = excluded.session_id,
         name = excluded.name,
         agent_type = excluded.agent_type,
         descriptor_source = COALESCE(excluded.descriptor_source, descriptor_source),
         batch_id = excluded.batch_id,
         task_key = excluded.task_key,
         owner_pid = excluded.owner_pid,
         owner_started_at = excluded.owner_started_at,
         ended_at = NULL`,
      [
        record.toolCallId,
        record.agentId,
        record.sessionId ?? null,
        record.name,
        record.agentType,
        record.descriptorSource ?? null,
        record.status,
        record.batchId ?? null,
        record.taskKey ?? null,
        record.ownerPid ?? me.pid,
        record.ownerStartedAt ?? me.startedAt,
        record.startedAt ?? Date.now(),
      ]
    );
  }

  /** ⑥ 逐任务写回终态（并行批次里每个 worker 各自一次，完成即写） */
  async settleRun(
    toolCallId: string,
    status: Extract<PersistedRunStatus, 'completed' | 'failed' | 'unknown'>,
    opts: {
      outputSummary?: string;
      error?: string;
      endedAt?: number;
      /**
       * 接线期③ ③-A（2026-09-24）：**未完成 run** 的失败归因（图快照 + 根因候选）。
       * 与 `outputSummary` 同 COALESCE 语义：未给出则保留既有值。
       */
      attribution?: AgentRunAttribution;
    } = {}
  ): Promise<boolean> {
    await this.init();
    // O13：**终态幂等**（与内存台账 `AgentRunLedger.settle` 同一语义）——
    // 无此条件时，"已完成、收尾组装抛错"会被反向写成 `failed`，而内存侧仍持
    // `completed` ⇒ 同一事实两个答案（内存/磁盘分叉）。
    // 注：`unknown`（陈旧自愈）**不在**守卫内 —— 它不是终态，续跑进程仍可落真实结果。
    const changed = await this.run(
      `UPDATE ${AGENT_RUNS_TABLE}
       SET status = ?, output_summary = COALESCE(?, output_summary),
           error = COALESCE(?, error), ended_at = ?,
           attribution_json = COALESCE(?, attribution_json)
       WHERE tool_call_id = ? AND status NOT IN ('completed', 'failed')`,
      [
        status,
        opts.outputSummary ?? null,
        opts.error ?? null,
        opts.endedAt ?? Date.now(),
        opts.attribution ? JSON.stringify(opts.attribution) : null,
        toolCallId,
      ]
    );
    return changed > 0;
  }

  /**
   * O19（v2）：记录**描述符来源**（`role-store` / `registry` / `builtin` / `default`）。
   *
   * 写入时机：解析链命中后**立即**写（早于终态）—— 若只在结算时写，那么"解析之后、
   * 结算之前"崩溃的行会缺来源；而"这次 run 用的是 DB 角色还是内置"正是排障第一问。
   * 幂等：重复写同一值无副作用；**不改状态列**（与 `settleRun` 的终态守卫互不干扰）。
   */
  async setDescriptorSource(toolCallId: string, source: string): Promise<void> {
    await this.init();
    await this.run(
      `UPDATE ${AGENT_RUNS_TABLE} SET descriptor_source = ? WHERE tool_call_id = ?`,
      [source, toolCallId]
    );
  }

  /**
   * O10a③ 补链（P1-D，2026-09-21）：把内存台账的 `cancel_requested` **中间态落到磁盘**。
   *
   * 修复前：`cancel_requested` 在全仓**只有内存写入点**（`AgentRunLedger.requestCancel`），
   * 本类虽在 `PersistedRunStatus` 声明了该态、且 `markStaleRunsUnknown` 的 SELECT/UPDATE
   * 都在处理它 —— 但**没有任何代码写过它** ⇒ 死状态。后果：经 `/v1/agents/stop` 受理的
   * 取消，磁盘台账仍是 `running`，重启后被陈旧自愈判成 `unknown`（"无法证明结果"），
   * 而真相是"取消已受理、正在安全边界收敛"。内存里精心设计的中间态在持久层没有对应物。
   *
   * 幂等与守卫：
   *  · `WHERE status = 'running'` —— 只从 `running` 迁入（与 `canTransition` 同语义：
   *    `cancel_requested` 不可再迁入，终态不可改写）；
   *  · **不写 `ended_at`** —— 取消只是受理，run 尚未终结（终态由执行路径经 `settleRun` 落定）。
   *
   * 匹配口径：单代理路径 `tool_call_id === agentId`（`beginRun` 用 agentId 起跑）；
   * 并行批次的每一行是 `${batchId}::${taskKey}`，而控制面拿到的是 `batchId` ⇒
   * 需同时匹配"精确 id"与"以 `<id>::` 开头的批次内逐任务行"。用 `instr()` 而非 `LIKE`
   * —— agentId 含用户可控的 name 段（`createAgentId` 直接拼接 `agentInput.name`），
   * `%`/`_` 会被 `LIKE` 当通配符误伤。
   *
   * @returns 实际改动的行数（0 ⇒ 无匹配的 `running` 行，非异常）
   */
  async markCancelRequested(agentId: string): Promise<number> {
    await this.init();
    return this.run(
      `UPDATE ${AGENT_RUNS_TABLE}
       SET status = 'cancel_requested'
       WHERE status = 'running'
         AND (tool_call_id = ? OR instr(tool_call_id, ? || '::') = 1)`,
      [agentId, agentId]
    );
  }

  /**
   * 查询（巡检/测试用）
   *
   * ⚠ 必须先 `await this.init()` —— 与 `startRun`/`settleRun` 等写方法同约定：
   * 单例首次创建时初始化是 **fire-and-forget**（`getAgentRunStore()` 内 `.catch()`），
   * 若读方法不 await，冷启动（本进程尚无任何 run 写入）时会直读 `this.db === null`
   * ⇒ 抛 "Database not initialized"（T8 端点冒烟实测复现）。
   */
  async getRun(toolCallId: string): Promise<AgentRunRow | null> {
    await this.init();
    const row = await this.get<Record<string, unknown>>(
      `SELECT * FROM ${AGENT_RUNS_TABLE} WHERE tool_call_id = ?`,
      [toolCallId]
    );
    return row ? AgentRunStore.toRow(row) : null;
  }

  /** 列出指定状态的行（巡检/测试用） */
  async listRuns(status?: PersistedRunStatus): Promise<AgentRunRow[]> {
    // 同 `getRun`：读方法必须等初始化完成（否则冷启动直读 null 连接）
    await this.init();
    const rows = status
      ? await this.all<Record<string, unknown>>(
          `SELECT * FROM ${AGENT_RUNS_TABLE} WHERE status = ? ORDER BY started_at ASC`,
          [status]
        )
      : await this.all<Record<string, unknown>>(
          `SELECT * FROM ${AGENT_RUNS_TABLE} ORDER BY started_at ASC`
        );
    return rows.map(AgentRunStore.toRow);
  }

  /** 释放连接（不泄漏） */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
    }
  }

  // ==================== 内部：sqlite 回调封装 ====================

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

  private get<T>(sql: string, params: unknown[] = []): Promise<T | null> {
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

  private static toRow(raw: Record<string, unknown>): AgentRunRow {
    return {
      toolCallId: String(raw['tool_call_id']),
      agentId: String(raw['agent_id']),
      sessionId: (raw['session_id'] as string | null) ?? undefined,
      name: String(raw['name']),
      agentType: String(raw['agent_type']),
      status: raw['status'] as PersistedRunStatus,
      batchId: (raw['batch_id'] as string | null) ?? undefined,
      taskKey: (raw['task_key'] as string | null) ?? undefined,
      outputSummary: (raw['output_summary'] as string | null) ?? undefined,
      error: (raw['error'] as string | null) ?? undefined,
      ownerPid: (raw['owner_pid'] as number | null) ?? undefined,
      ownerStartedAt: (raw['owner_started_at'] as number | null) ?? undefined,
      startedAt: Number(raw['started_at']),
      endedAt: (raw['ended_at'] as number | null) ?? undefined,
      descriptorSource:
        (raw['descriptor_source'] as string | null) ?? undefined,
      attribution: parseAttribution(raw['attribution_json']),
      deliveryState: String(raw['delivery_state'] ?? 'pending'),
      deliveryAttempts: Number(raw['delivery_attempts'] ?? 0),
    };
  }
}

/**
 * 解析落盘的归因 JSON（接线期③ ③-A）。
 *
 * 由 `JSON.stringify(AgentRunAttribution)` 写入；损坏时**不抛**（一行坏数据不应让整个
 * run 列表接口失败），但**记 warn** —— 回退不得掩盖错误（CS03-002）。
 */
function parseAttribution(value: unknown): AgentRunAttribution | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  try {
    return JSON.parse(value) as AgentRunAttribution;
  } catch (error) {
    logger.warn('attribution_json 解析失败（该行按无归因处理）', {
      error: String(error),
    });
    return undefined;
  }
}

/** 全局单例（形态与 `AgentRoleStore` / `getSubAgentEngine` 一致） */
let instance: AgentRunStore | null = null;

export function getAgentRunStore(): AgentRunStore {
  if (!instance) {
    instance = new AgentRunStore();
    // 启动即初始化（建表/补列/schema_version/陈旧自愈/保留裁剪）；
    // 失败不抛出（写路径会再 await init，届时错误可见），仅记录
    instance.init().catch((err) => {
      logger.error('AgentRunStore 初始化失败', { error: String(err) });
    });
  }
  return instance;
}

/**
 * 测试专用：替换 / 复位全局单例（与 `resetAgentRunLedger`、`resetAgentToolManager` 同惯例）。
 *
 * 背景（台账 N-46）：`AgentTool.execute()` → `beginRun()` → `getAgentRunStore().startRun()`
 * 走的是**全局单例**，其 DB 路径来自 `resolveDbPath()`（即生产 `~/.pyapp/data/app.db`），
 * 而 `AgentTool` 的单元测试只注入了 fake 引擎 / fake 解析器 —— **落盘这一段是真实生产存储**
 * （实测：跑一次 `agentDelegationGrant.test.ts` 后真机 `GET /v1/agents/runs` 的
 * total 由 50 → 52，且前端「Agent 角色 → 运行态」面板会把这些测试行当真实记录展示）。
 *
 * 由测试 preload（`tests/setupIsolateAgentStore.ts`，经 `app/bunfig.toml` 加载）
 * 把单例指向临时 DB；传 `null` 可复位。
 */
export function setAgentRunStoreForTest(store: AgentRunStore | null): void {
  instance = store;
}
