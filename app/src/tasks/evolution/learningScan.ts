// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 学习候选生成（S1 采集 → S2 归因 → S3 台账 的**纯函数**部分，2026-11-15 M1）
 *
 * 输入是**一个会话的事件序列**（`EventLogQuery` 取回，按 `seq` 升序），输出是待入库的候选。
 * 三条纪律：
 * - **只读事件**：不写事件、不改会话状态（与 U4 评估器的"只读水位"同口径）；
 * - **阈值单源**：低分阈值由调用方注入（生产取 `@modules/evals` 的 `SUSPICIOUS_SCORE_THRESHOLD`），
 *   本文件不复制第二份数值（CS01）；
 * - **可重放**：同会话同轮同类 ⇒ 候选 id 相同（{@link computeLearningCandidateId}），重复扫描幂等。
 */

import type { LiriEvent } from '@modules/session/types/events';
import type { LiriEventMap } from '@modules/session/types/eventPayloads';
import {
  attributeBadcase,
  collectTurnToolObservations,
  type BadcaseCategory,
} from './badcaseAttribution';
import {
  computeLearningCandidateId,
  type LearningCandidateContent,
} from './learningCandidates';

/** 单次扫描单会话最多产出的候选数（防一次刷屏；超出的低分轮按分数升序截断） */
export const LEARNING_SCAN_MAX_CANDIDATES = 20;

/** 扫描参数 */
export interface BuildLearningCandidatesOptions {
  sessionId: string;
  events: readonly LiriEvent[];
  /** 低分阈值（低于此分才产候选；生产传 `SUSPICIOUS_SCORE_THRESHOLD`） */
  scoreCutoff: number;
  /**
   * 按类别的**收紧阈值**（S6 阈值回流；缺省 = 不收紧）。
   *
   * 由 `suggestCategoryCutoffs()` 派生；只对该类别生效，其余类别仍用 `scoreCutoff`。
   */
  categoryCutoffs?: Partial<Record<BadcaseCategory, number>>;
  /** 单会话上限（默认 {@link LEARNING_SCAN_MAX_CANDIDATES}） */
  limit?: number;
}

/** 汇总文案（供 `/learn list` 单行展示；**只拼结构化字段**，不做语义推测） */
function summarize(
  turnNumber: number,
  category: BadcaseCategory,
  score: number,
  evidence: readonly string[]
): string {
  const detail = evidence.filter((e) => !e.startsWith('score=')).join('；');
  return `第 ${turnNumber} 轮 ${category}（score ${score.toFixed(2)}）${detail ? `：${detail}` : ''}`;
}

/**
 * 轮次 → 该轮用户输入（**结构化配对**，不做文案猜测）。
 *
 * 依据两条既有字段：
 * - `turn/start.userMessageSeq`（有则按 `seq` 精确取 `user/message.content`）；
 * - 否则取该 `turn/start` **之前最近一条** `user/message`（会话事件按 `seq` 升序）。
 *
 * 取不到就不登记（`input` 是可选证据，不伪造）。
 */
export function collectTurnUserInputs(
  events: readonly LiriEvent[]
): Map<number, string> {
  const contentBySeq = new Map<number, string>();
  let lastContent: string | null = null;
  const inputs = new Map<number, string>();
  for (const event of events) {
    if (event.type === 'user/message') {
      const payload = event.data as LiriEventMap['user/message'];
      if (typeof payload.content === 'string' && payload.content.trim()) {
        contentBySeq.set(event.seq, payload.content);
        lastContent = payload.content;
      }
      continue;
    }
    if (event.type !== 'turn/start') continue;
    const payload = event.data as LiriEventMap['turn/start'];
    if (inputs.has(payload.turn)) continue;
    const bySeq =
      payload.userMessageSeq === undefined
        ? undefined
        : contentBySeq.get(payload.userMessageSeq);
    const content = bySeq ?? lastContent;
    if (content) inputs.set(payload.turn, content);
  }
  return inputs;
}

/**
 * 从会话事件生成候选（纯函数）。
 *
 * 判定链路：`turn/quality` 分数 < `scoreCutoff` ⇒ 归因（带该轮工具观测）⇒ 候选内容。
 * 同轮已有多条 `turn/quality`（重评）时**取最后一条**（事件按 seq 升序 ⇒ 后者覆盖前者）。
 */
export function buildLearningCandidates(
  options: BuildLearningCandidatesOptions
): LearningCandidateContent[] {
  const { sessionId, events, scoreCutoff } = options;
  const limit = options.limit ?? LEARNING_SCAN_MAX_CANDIDATES;
  const toolsByTurn = collectTurnToolObservations(events);
  const inputsByTurn = collectTurnUserInputs(events);

  /** 轮次 → 最后一轮质量事件（重评覆盖） */
  const latestByTurn = new Map<number, LiriEventMap['turn/quality']>();
  for (const event of events) {
    if (event.type !== 'turn/quality') continue;
    const payload = event.data as LiriEventMap['turn/quality'];
    latestByTurn.set(payload.turnNumber, payload);
  }

  const candidates: LearningCandidateContent[] = [];
  for (const [turnNumber, quality] of latestByTurn) {
    const attribution = attributeBadcase({
      quality,
      tools: toolsByTurn.get(turnNumber) ?? [],
    });
    // S6 阈值回流：该类别被收紧时用更严的阈值；未收紧的类别行为与旧口径逐字一致
    const cutoff =
      options.categoryCutoffs?.[attribution.category] ?? scoreCutoff;
    if (quality.score >= cutoff) continue;
    const input = inputsByTurn.get(turnNumber);
    candidates.push({
      id: computeLearningCandidateId(
        sessionId,
        turnNumber,
        attribution.category
      ),
      sessionId,
      turnNumber,
      category: attribution.category,
      score: quality.score,
      evidence: attribution.evidence,
      summary: summarize(
        turnNumber,
        attribution.category,
        quality.score,
        attribution.evidence
      ),
      ...(input ? { input } : {}),
    });
  }

  candidates.sort((a, b) => a.score - b.score);
  return candidates.slice(0, limit);
}
