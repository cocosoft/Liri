// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * GoalMetricsService — PDCA 灰度指标落库（S2，P1-5 §5 S2 + StageOrchestrator §4.6）
 *
 * 两类行类型（不互踩字段）：
 *   - goal_metrics 表：stage 粒度（每阶段一行，row_type='stage'，含 stage_id）
 *   - usage_records 表：message 粒度（会话 usage 行，avgTokenCostPerTask 数据源）
 *
 * 幂等迁移：PRAGMA table_info 检测缺失列 → ALTER TABLE ADD COLUMN
 * （对齐 InboxManager._migrateSchema 模式；存量库仅新增字段，不删结构）。
 */

import { Database } from '@modules/core/external/sqlite3';
import { randomUUID } from 'crypto';
import { resolveDbPath } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { SCHEMA, TABLE_NAMES } from './schema';

const logger = getLogger('tasks:goalMetrics');

/** stage 粒度指标输入（goal_metrics 行） */
export interface StageMetricInput {
  goalId: string;
  sessionId: string;
  /** 阶段 ID（如 'execute' / 'requirement' / 'design'…） */
  stageId: string;
  /** P1-2（2026-08-31）：本阶段 turn 预算上限（PDCA maxIterations，NULL 表示未配置） */
  maxTurns?: number;
  totalTurns?: number;
  totalTokens?: number;
  totalCostUsd?: number;
  autoVerifyCount?: number;
  autoVerifyPassCount?: number;
  userInterventionCount?: number;
  durationMs?: number;
}

/** message 粒度用量输入（usage_records 行） */
export interface MessageUsageInput {
  sessionId: string;
  totalTokens?: number;
  costEstimated?: number;
  durationMs?: number;
}

/** goal_metrics 行（读取用） */
export interface StageMetricRow {
  id: string;
  goalId: string;
  sessionId: string;
  rowType: string;
  stageId: string | null;
  maxTurns: number | null;
  totalTurns: number;
  totalTokens: number;
  totalCostUsd: number;
  durationMs: number;
  createdAt: number;
}

/** usage_records 行（读取用） */
export interface MessageUsageRow {
  id: string;
  sessionId: string;
  date: string;
  totalTokens: number;
  costEstimated: number;
  durationMs: number;
  createdAt: number;
}

/** review_samples 评估样例输入（方向 4 Spec，2026-09-03） */
export interface ReviewSampleInput {
  pdcaTaskId: string;
  sessionId?: string;
  goalText: string;
  stage: 'pdca_completed' | 'pdca_aborted';
  /** PlanStep[] 精简快照 JSON（含 dependsOn/decision/review/retryCount） */
  stepsJson: string;
  reviewPassRate?: number;
  converged?: boolean;
  confidence?: number;
  reason?: string;
  autonomyLevel?: number;
  totalTokens?: number;
  durationMs?: number;
}

/** review_samples 行（读取用） */
export interface ReviewSampleRow {
  id: string;
  pdcaTaskId: string;
  sessionId: string | null;
  goalText: string;
  stage: string;
  stepsJson: string;
  reviewPassRate: number | null;
  converged: number | null;
  confidence: number | null;
  reason: string | null;
  humanDecision: string | null;
  autonomyLevel: number | null;
  totalTokens: number | null;
  durationMs: number | null;
  createdAt: number;
}

function run(db: Database, sql: string, params: unknown[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function exec(db: Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function all<T>(
  db: Database,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err: Error | null, rows: T[]) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

export class GoalMetricsService {
  private db: Database | null = null;

  constructor(private dbPath: string = resolveDbPath()) {}

  async init(): Promise<void> {
    if (this.db) return;
    this.db = await new Promise<Database>((resolve, reject) => {
      const db = new Database(this.dbPath, (err) => {
        if (err) reject(err);
        else resolve(db);
      });
    });
    // 幂等建表（多语句需用 exec，与 SqliteTaskStore.createTables 一致）
    await exec(this.db, SCHEMA);
    // 存量库列迁移：仅新增缺失列
    await this._migrateSchema();
  }

  /** 幂等列迁移：goal_metrics 补充 row_type / stage_id */
  private async _migrateSchema(): Promise<void> {
    const db = this.db;
    if (!db) return;
    const columns = await all<{ name: string }>(
      db,
      'PRAGMA table_info(goal_metrics)'
    );
    const existing = new Set(columns.map((c) => c.name));

    const migrations: [string, string][] = [
      [
        'row_type',
        "ALTER TABLE goal_metrics ADD COLUMN row_type TEXT NOT NULL DEFAULT 'goal'",
      ],
      ['stage_id', 'ALTER TABLE goal_metrics ADD COLUMN stage_id TEXT'],
      ['max_turns', 'ALTER TABLE goal_metrics ADD COLUMN max_turns INTEGER'],
    ];

    for (const [col, sql] of migrations) {
      if (existing.has(col)) continue;
      try {
        await run(db, sql);
        logger.info('goal_metrics 列迁移完成', { column: col });
      } catch (err) {
        await handleError(err, {
          module: 'tasks:goalMetrics',
          action: 'migrateColumn',
          context: { column: col },
        });
      }
    }
  }

  /** stage 粒度指标落库（goal_metrics 行，row_type='stage'） */
  async recordStageMetric(input: StageMetricInput): Promise<void> {
    const db = this.db;
    if (!db) return;
    await run(
      db,
      `INSERT INTO ${TABLE_NAMES.GOAL_METRICS}
        (id, goal_id, session_id, row_type, stage_id, max_turns, total_turns,
         total_tokens, total_cost_usd, auto_verify_count, auto_verify_pass_count,
         user_intervention_count, duration_ms, created_at)
       VALUES (?, ?, ?, 'stage', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.goalId,
        input.sessionId,
        input.stageId,
        input.maxTurns ?? null,
        input.totalTurns ?? 0,
        input.totalTokens ?? 0,
        input.totalCostUsd ?? 0,
        input.autoVerifyCount ?? 0,
        input.autoVerifyPassCount ?? 0,
        input.userInterventionCount ?? 0,
        input.durationMs ?? 0,
        Date.now(),
      ]
    );
  }

  /** message 粒度用量落库（usage_records 行，avgTokenCostPerTask 数据源） */
  async recordMessageUsage(input: MessageUsageInput): Promise<void> {
    const db = this.db;
    if (!db) return;
    await run(
      db,
      `INSERT INTO ${TABLE_NAMES.USAGE_RECORDS}
        (id, session_id, date, total_tokens, cost_estimated, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.sessionId,
        new Date().toISOString().slice(0, 10),
        input.totalTokens ?? 0,
        input.costEstimated ?? 0,
        input.durationMs ?? 0,
        Date.now(),
      ]
    );
  }

  /** 任务级评估样例落库（review_samples，方向 4 Spec；幂等：同 pdca_task_id 已存在则跳过） */
  async recordReviewSample(input: ReviewSampleInput): Promise<void> {
    const db = this.db;
    if (!db) return;
    const dup = await all<{ id: string }>(
      db,
      `SELECT id FROM ${TABLE_NAMES.REVIEW_SAMPLES} WHERE pdca_task_id = ?`,
      [input.pdcaTaskId]
    );
    if (dup.length > 0) return;
    await run(
      db,
      `INSERT INTO ${TABLE_NAMES.REVIEW_SAMPLES}
        (id, pdca_task_id, session_id, goal_text, stage, steps_json, review_pass_rate,
         converged, confidence, reason, human_decision, autonomy_level,
         total_tokens, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.pdcaTaskId,
        input.sessionId ?? null,
        input.goalText,
        input.stage,
        input.stepsJson,
        input.reviewPassRate ?? null,
        input.converged === undefined ? null : input.converged ? 1 : 0,
        input.confidence ?? null,
        input.reason ?? null,
        null, // human_decision：人工回填位
        input.autonomyLevel ?? null,
        input.totalTokens ?? null,
        input.durationMs ?? null,
        Date.now(),
      ]
    );
  }

  /** 查询评估样例（可选按 pdca_task_id 过滤；方向 4 回归数据源） */
  async queryReviewSamples(filter?: {
    pdcaTaskId?: string;
    limit?: number;
  }): Promise<ReviewSampleRow[]> {
    const db = this.db;
    if (!db) return [];
    const where = filter?.pdcaTaskId ? 'WHERE pdca_task_id = ?' : '';
    const params: unknown[] = filter?.pdcaTaskId ? [filter.pdcaTaskId] : [];
    const limitSql = filter?.limit ? 'LIMIT ?' : '';
    if (filter?.limit) params.push(filter.limit);
    const rows = await all<Record<string, unknown>>(
      db,
      `SELECT id, pdca_task_id, session_id, goal_text, stage, steps_json, review_pass_rate,
              converged, confidence, reason, human_decision, autonomy_level,
              total_tokens, duration_ms, created_at
         FROM ${TABLE_NAMES.REVIEW_SAMPLES}
        ${where}
        ORDER BY created_at
        ${limitSql}`,
      params
    );
    // sqlite 返回下划线列名 → 映射 camelCase 行
    return rows.map((r) => ({
      id: r.id as string,
      pdcaTaskId: r.pdca_task_id as string,
      sessionId: (r.session_id as string | null) ?? null,
      goalText: r.goal_text as string,
      stage: r.stage as string,
      stepsJson: r.steps_json as string,
      reviewPassRate: (r.review_pass_rate as number | null) ?? null,
      converged: (r.converged as number | null) ?? null,
      confidence: (r.confidence as number | null) ?? null,
      reason: (r.reason as string | null) ?? null,
      humanDecision: (r.human_decision as string | null) ?? null,
      autonomyLevel: (r.autonomy_level as number | null) ?? null,
      totalTokens: (r.total_tokens as number | null) ?? null,
      durationMs: (r.duration_ms as number | null) ?? null,
      createdAt: r.created_at as number,
    }));
  }

  /** 查询 stage 粒度行（可选按 goalId 过滤；S4 决策数据源） */
  async queryStageMetrics(goalId?: string): Promise<StageMetricRow[]> {
    const db = this.db;
    if (!db) return [];
    const rows = await all<Record<string, unknown>>(
      db,
      `SELECT id, goal_id, session_id, row_type, stage_id,
              max_turns, total_turns, total_tokens, total_cost_usd, duration_ms, created_at
         FROM ${TABLE_NAMES.GOAL_METRICS}
        WHERE row_type = 'stage' ${goalId ? 'AND goal_id = ?' : ''}
        ORDER BY created_at`,
      goalId ? [goalId] : []
    );
    return rows.map((r) => ({
      id: String(r.id),
      goalId: String(r.goal_id),
      sessionId: String(r.session_id),
      rowType: String(r.row_type),
      stageId: r.stage_id == null ? null : String(r.stage_id),
      maxTurns: r.max_turns == null ? null : Number(r.max_turns),
      totalTurns: Number(r.total_turns ?? 0),
      totalTokens: Number(r.total_tokens ?? 0),
      totalCostUsd: Number(r.total_cost_usd ?? 0),
      durationMs: Number(r.duration_ms ?? 0),
      createdAt: Number(r.created_at ?? 0),
    }));
  }

  /** 查询 message 粒度行（可选按 sessionId 过滤） */
  async queryMessageUsage(sessionId?: string): Promise<MessageUsageRow[]> {
    const db = this.db;
    if (!db) return [];
    const rows = await all<Record<string, unknown>>(
      db,
      `SELECT id, session_id, date, total_tokens, cost_estimated, duration_ms, created_at
         FROM ${TABLE_NAMES.USAGE_RECORDS}
        ${sessionId ? 'WHERE session_id = ?' : ''}
        ORDER BY created_at`,
      sessionId ? [sessionId] : []
    );
    return rows.map((r) => ({
      id: String(r.id),
      sessionId: String(r.session_id),
      date: String(r.date),
      totalTokens: Number(r.total_tokens ?? 0),
      costEstimated: Number(r.cost_estimated ?? 0),
      durationMs: Number(r.duration_ms ?? 0),
      createdAt: Number(r.created_at ?? 0),
    }));
  }
}

/** 全局单例（与 taskOrchestrator 单例同构，S1 记账同源验证关联） */
export const goalMetricsService = new GoalMetricsService();
