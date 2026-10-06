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
 * U4 在线质量评估：**编排**（取水位 → 派生信号 → 打分 → 可疑轮复核 → 落事件）。
 *
 * 规格：`.trae/specs/online-quality-evaluation.md` §3 D2/D3/D4/D5。
 *
 * 设计要点（都有既有先例，非本项发明）：
 * - **句柄全注入**：`EventLogStorage` **由 `chat/` 持有**（`CompactionOrchestrator.ts:208` 明文），
 *   非 chat 模块一律走**注入回调**（`RequestSnapshotService` / `requestPrep` / `requestBoundary` 三处同范式）
 *   ⇒ 本模块**不 import 任何存储实现**，只依赖 `LiriEvent` / `LiriEventMap` **类型**（app → service 合法）。
 * - **水位事件派生**：不引入隐藏状态 —— "上次评到哪"由该会话最后一条 `turn/quality` 事件的 `seq` 得出，
 *   重启后可继续（不重评、不漏评）。
 * - **连续低分也事件派生**：回溯少量历史 `turn/quality` 事件数尾部低分（供 D2 规则 4），
 *   避免内存态与日志不一致。
 * - **成本硬上限**：单次 pass 最多复核 `MAX_REVIEWS_PER_IDLE` 轮（**分数最低者优先**）；
 *   **未注入复核器 ⇒ 全部跳过并标 `'no-model'`**（不擅自选模型，`model-usage.md`）。
 * - **让出事件循环**：每处理 `YIELD_EVERY_TURNS` 轮 `setImmediate`（镜像去重/冲突检测的分片手法）。
 * - **错误隔离**：单会话失败**不中断**整轮 pass，逐条记入 `result.errors` 由调用方（chat 的 onIdle）
 *   统一 `handleError` 上报 —— 本模块**不吞错、也不越层引 logger**。
 */

import type { LiriEvent, LiriEventType } from '@modules/session/types/events';
import type { LiriEventMap } from '@modules/session/types/eventPayloads';
// 从**模块出口**导入（R03-002：禁子目录 import；`session/index.ts:129` 已转出）
import type { EventLogQuery } from '@modules/session';
import { deriveTurnSignals, type DerivedTurn } from './deriveTurnSignals.js';
import { isSuspicious, nextLowScoreStreak, scoreTurn } from './turnQuality.js';
import type { TurnQualityReview, TurnScore } from './types.js';
import { MAX_REVIEWS_PER_IDLE, SUSPICIOUS_SCORE_THRESHOLD } from './weights.js';

/** `turn/quality` 事件载荷（取自事件契约，**不复制形状**） */
type TurnQualityData = LiriEventMap['turn/quality'];

/** 派生打分所需的事件类型白名单（白名单读取比全量读省） */
const SIGNAL_EVENT_TYPES: LiriEventType[] = [
  'turn/start',
  'turn/end',
  'assistant/tool_call',
  'metric/timing',
];

/** 回溯多少条历史 `turn/quality` 事件用于"连续低分"与水位（够覆盖阈值即可） */
const QUALITY_LOOKBACK = 20;

/**
 * 从水位**再往前**回看多少 seq 作为信号读取起点。
 *
 * 为什么不能只读 `水位+1`：水位 = 最后一条 `turn/quality` 的 seq，而空闲期评估与
 * 主链路**并发** —— 若水位恰好落在某轮**中途**（该轮 `turn/start` 已写、`turn/end` 未写），
 * 那么下一轮 pass 从 `水位+1` 读就会**看不到该轮的 start** ⇒ 该轮**永不评分**。
 * 回看一段窗口 + 用 `turnNumber` 去重（见 `evaluateSession` 第 ③ 步）即可兼顾
 * **不漏评**与**不重评**。
 *
 * 边界（如实）：单轮事件数**超过**本窗口时，该轮仍可能被漏评（不会误评）；本仓单轮
 * 事件量远小于该值（连字符/文本走 `assistant/text-batch` 聚合）。
 */
const SIGNAL_SEQ_LOOKBACK = 500;

/** 单次 pass 单会话最多评多少轮（防长会话一次空闲吃满 CPU；余量留待下次空闲） */
const MAX_TURNS_PER_PASS = 200;

/** 每处理多少轮让出一次事件循环 */
const YIELD_EVERY_TURNS = 20;

/** 注入端口（由装配方/chat 侧提供；见文件头"句柄全注入"） */
export interface TurnQualityEvaluatorPorts {
  /**
   * 读会话事件（薄包 `EventLogStorage.read`）。
   *
   * 入参直接用既有查询契约 `EventLogQuery`（**不另造一套查询类型**，CS01）。
   */
  readEvents(sessionId: string, query: EventLogQuery): Promise<LiriEvent[]>;
  /** 追加事件（薄包 `EventLogStorage.append`；`type` 固定为 `turn/quality`） */
  appendEvent(
    sessionId: string,
    event: { type: 'turn/quality'; data: TurnQualityData }
  ): Promise<void>;
  /**
   * 可疑轮的 LLM 复核（**可选**）。
   *
   * 装配方负责复用既有 `VerifierAgent` 并把模型取自 `TaskModelConfig.verifier`
   * （`model-usage.md`：不得硬编码、不得擅自选模型）。
   * **未注入 ⇒ 全部跳过**并记 `reviewSkipped: 'no-model'`。
   * 返回 `null` = 复核未得出可用结论（同样记 `'no-model'`）。
   */
  reviewTurn?(input: {
    sessionId: string;
    turnNumber: number;
  }): Promise<TurnQualityReview | null>;
}

export interface TurnQualityPassOptions {
  /** 本次要评的会话（调用方决定范围：如空闲期取"最近被触碰的会话"） */
  sessionIds: string[];
  /** 覆盖让出间隔（测试用小值；缺省 `YIELD_EVERY_TURNS`） */
  yieldEvery?: number;
}

export interface TurnQualityPassResult {
  /** 实际处理的会话数 */
  sessions: number;
  /** 本次写入的 `turn/quality` 事件数 */
  scored: number;
  /** 触发并完成的 LLM 复核数 */
  reviewed: number;
  /** 因上限/未配模型而**跳过**复核的次数 */
  skippedReviews: number;
  /** 单会话级失败（调用方负责上报；本模块不吞错） */
  errors: Array<{ sessionId: string; message: string }>;
  elapsedMs: number;
}

/** 事件循环让出（镜像 `findDuplicatesChunked` / `detectChunked` 手法） */
function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * 从历史 `turn/quality` 事件求三个量（**全部由事件派生，无隐藏状态**）：
 * - `lastSeq`：水位 seq（最后一条 `turn/quality` 的 seq）
 * - `lastTurnNumber`：最后**已评**的轮号（用于去重 —— 防重复评分）
 * - `lowScoreStreak`：尾部连续低分轮数（供 D2 规则 4）
 */
function readWatermark(history: LiriEvent[]): {
  lastSeq: number;
  lastTurnNumber: number;
  lowScoreStreak: number;
} {
  const sorted = [...history].sort((a, b) => a.seq - b.seq);
  let lastSeq = 0;
  let lastTurnNumber = 0;
  let streak = 0;
  for (const ev of sorted) {
    if (ev.type !== 'turn/quality') continue;
    lastSeq = Math.max(lastSeq, ev.seq);
    const data = ev.data as { score?: number; turnNumber?: number };
    if (typeof data.turnNumber === 'number') {
      lastTurnNumber = Math.max(lastTurnNumber, data.turnNumber);
    }
    streak = nextLowScoreStreak(
      streak,
      typeof data.score === 'number' && data.score < SUSPICIOUS_SCORE_THRESHOLD
    );
  }
  return { lastSeq, lastTurnNumber, lowScoreStreak: streak };
}

/**
 * 执行一次在线质量评估 pass（**空闲期调用**；主链不得调用）。
 *
 * 幂等：以事件水位为准 ⇒ 同一批轮次不会被重复评分；新轮次在下次空闲补齐。
 */
export async function runTurnQualityPass(
  ports: TurnQualityEvaluatorPorts,
  options: TurnQualityPassOptions
): Promise<TurnQualityPassResult> {
  const startedAt = Date.now();
  const yieldEvery = Math.max(1, options.yieldEvery ?? YIELD_EVERY_TURNS);
  const result: TurnQualityPassResult = {
    sessions: 0,
    scored: 0,
    reviewed: 0,
    skippedReviews: 0,
    errors: [],
    elapsedMs: 0,
  };

  for (const sessionId of options.sessionIds) {
    result.sessions += 1;
    try {
      await evaluateSession(ports, sessionId, yieldEvery, result);
    } catch (e: unknown) {
      result.errors.push({
        sessionId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  result.elapsedMs = Date.now() - startedAt;
  return result;
}

/** 单会话：水位 → 派生 → 打分 → 可疑 → 复核（上限）→ 落事件 */
async function evaluateSession(
  ports: TurnQualityEvaluatorPorts,
  sessionId: string,
  yieldEvery: number,
  result: TurnQualityPassResult
): Promise<void> {
  // ① 水位 + 连续低分（均由既有事件派生，无隐藏状态）
  const history = await ports.readEvents(sessionId, {
    types: ['turn/quality'],
    limit: QUALITY_LOOKBACK,
  });
  const { lastSeq, lastTurnNumber, lowScoreStreak } = readWatermark(history);

  // ② 派生"水位附近起"的轮次（回看窗口 ⇒ 不漏评），再按轮号去重 ⇒ 不重评
  const fromSeq = Math.max(1, lastSeq + 1 - SIGNAL_SEQ_LOOKBACK);
  const freshEvents = await ports.readEvents(sessionId, {
    fromSeq,
    types: SIGNAL_EVENT_TYPES,
  });
  const derived = deriveTurnSignals(freshEvents)
    .filter((t) => t.turnNumber > lastTurnNumber)
    .slice(0, MAX_TURNS_PER_PASS);
  if (derived.length === 0) return;

  // ③ 打分（纯函数）+ 让出
  interface Scored {
    turn: DerivedTurn;
    score: number;
    /** 打分结果（`scoreTurn` 已保证非空 —— 派生只产已收轮） */
    scoreResult: TurnScore;
    reasons: string[];
    lowStreak: number;
  }
  const scored: Scored[] = [];
  let streak = lowScoreStreak;
  for (let i = 0; i < derived.length; i++) {
    const turn = derived[i];
    const sc = scoreTurn(turn.signals);
    if (!sc) continue; // 未终态（正常不会出现：派生只产已收轮）
    streak = nextLowScoreStreak(streak, sc.score < SUSPICIOUS_SCORE_THRESHOLD);
    const verdict = isSuspicious({
      signals: turn.signals,
      score: sc.score,
      consecutiveLowScores: streak,
    });
    scored.push({
      turn,
      score: sc.score,
      scoreResult: sc,
      reasons: verdict.reasons,
      lowStreak: streak,
    });
    if ((i + 1) % yieldEvery === 0) await yieldToEventLoop();
  }

  // ④ 复核：仅可疑轮，**分数最低者优先**，且受单次上限约束
  const suspicious = scored
    .filter((s) => s.reasons.length > 0)
    .sort((a, b) => a.score - b.score);

  const reviewByTurn = new Map<number, TurnQualityReview>();
  const skippedByTurn = new Map<number, 'no-model' | 'budget'>();
  if (suspicious.length > 0) {
    const reviewer = ports.reviewTurn;
    for (let i = 0; i < suspicious.length; i++) {
      const item = suspicious[i];
      if (!reviewer) {
        skippedByTurn.set(item.turn.turnNumber, 'no-model');
        result.skippedReviews += 1;
        continue;
      }
      if (i >= MAX_REVIEWS_PER_IDLE) {
        skippedByTurn.set(item.turn.turnNumber, 'budget');
        result.skippedReviews += 1;
        continue;
      }
      const review = await reviewer({
        sessionId,
        turnNumber: item.turn.turnNumber,
      });
      if (review) {
        reviewByTurn.set(item.turn.turnNumber, review);
        result.reviewed += 1;
      } else {
        skippedByTurn.set(item.turn.turnNumber, 'no-model');
        result.skippedReviews += 1;
      }
      await yieldToEventLoop();
    }
  }

  // ⑤ 落事件（本轮每个已评分轮一条）
  for (const item of scored) {
    const review = reviewByTurn.get(item.turn.turnNumber);
    const skipped = skippedByTurn.get(item.turn.turnNumber);
    const data: TurnQualityData = {
      turnNumber: item.turn.turnNumber,
      score: item.score,
      evaluatorVersion: item.scoreResult.evaluatorVersion,
      components: item.scoreResult.components,
      signals: {
        status: item.turn.signals.status,
        toolCalls: item.turn.signals.toolCalls,
        durationMs: item.turn.signals.durationMs,
        inputTokens: item.turn.signals.inputTokens,
        outputTokens: item.turn.signals.outputTokens,
      },
      reviewed: review !== undefined,
      ...(review ? { review } : {}),
      ...(skipped ? { reviewSkipped: skipped } : {}),
    };
    await ports.appendEvent(sessionId, { type: 'turn/quality', data });
    result.scored += 1;
  }
}
