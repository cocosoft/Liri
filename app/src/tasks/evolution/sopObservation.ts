// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * SOP 观察期度量（M7，2026-11-15）
 *
 * 规格：`.trae/specs/sop-observation-metrics.md`。
 *
 * 为什么不用 `skills-usage.json`：那份遥测只有聚合计数（无逐次时间、无会话/轮次关联），
 * 无法按观察窗切片。本模块改为**只读**会话事件：
 * - `assistant/tool_call`（工具名 `skill`、`op` 为 run、`args.name` = `sop-<id>`）⇒ 一次「使用」；
 * - `turn/quality`（`turnNumber` / `score`）⇒ 与该轮 join，判断是否伴随低分。
 *
 * 三条纪律：
 * - **结构化判定**（CS02）：只看 `op` / `args.name` / `turnNumber` / `score`，不做文案匹配；
 * - **不猜缺数**：有调用但该轮无质量事件 ⇒ 进 `unscoredTurns`，不计为通过也不计为低分；
 * - **零副作用**：纯函数 + 只读输入，不写台账、不改技能、不新增事件类型。
 */

import type { LiriEvent } from '@modules/session/types/events';
import type { LiriEventMap } from '@modules/session/types/eventPayloads';
import { TOOL_NAME_CONSTANTS } from '@openliri/infra/constants/toolNameConstants';

/** 默认观察窗（天；spec §6 的旧裁定） */
export const SOP_OBSERVATION_WINDOW_DAYS = 7;

/** 判为「被真实使用」的最小执行次数 */
export const SOP_OBSERVATION_MIN_USES = 5;

/** 单次观测扫描的会话数上限（与 `/learn scan` 同量级） */
export const SOP_OBSERVATION_SESSIONS = 20;

/** 单会话读取的事件上限（覆盖数轮） */
export const SOP_OBSERVATION_EVENTS = 1000;

/** 观测参数 */
export interface SopObservationWindow {
  /** 技能名（批准产物名，`sop-<id>`） */
  skillName: string;
  /** 观察窗起点（毫秒时间戳；早于它的事件不计） */
  since: number;
}

/** 单轮观测（只保留有执行的轮次） */
export interface SopTurnObservation {
  sessionId: string;
  turnNumber: number;
  /** 该轮执行该技能的次数 */
  uses: number;
  /** 该轮 `turn/quality` 分数（无质量事件 ⇒ `null`，不猜） */
  score: number | null;
}

/** 跨会话汇总 */
export interface SopObservation {
  skillName: string;
  /** 观察窗内执行次数合计 */
  uses: number;
  /** 有执行的轮次（按会话内轮次升序） */
  turns: SopTurnObservation[];
  /** 伴随低分的轮次 */
  lowScoreTurns: SopTurnObservation[];
  /** 有执行但缺质量事件的轮次 */
  unscoredTurns: SopTurnObservation[];
}

/** 判定三态：够量无低分 / 次数不足 / 伴随低分 */
export type SopObservationVerdict = 'supported' | 'insufficient' | 'flagged';

/** 判定结果（`reasons` 直接用于命令输出） */
export interface SopObservationJudgement {
  verdict: SopObservationVerdict;
  reasons: string[];
}

/** 是否为「执行该技能」的调用（`op=view/list` 不算；`op` 缺省 = run） */
function isSkillRun(
  payload: LiriEventMap['assistant/tool_call'],
  skillName: string
): boolean {
  if (payload.name !== TOOL_NAME_CONSTANTS.skill) return false;
  const args = payload.args;
  if (typeof args !== 'object' || args === null) return false;
  const record = args as Record<string, unknown>;
  const op = record.op;
  if (typeof op === 'string' && op !== 'run') return false;
  return record.name === skillName;
}

/**
 * 单会话 → 逐轮观测（纯函数）。
 *
 * 轮次归属只看 `turn/start`（不猜）；没有 `turn/start` 的调用不计入。
 * 同轮多条 `turn/quality`（重评）取最后一条。
 */
export function collectSopSkillObservations(
  sessionId: string,
  events: readonly LiriEvent[],
  window: SopObservationWindow
): SopTurnObservation[] {
  const perTurn = new Map<number, { uses: number; score: number | null }>();
  let currentTurn: number | null = null;

  const entryOf = (turn: number) => {
    const existing = perTurn.get(turn);
    if (existing) return existing;
    const created = { uses: 0, score: null as number | null };
    perTurn.set(turn, created);
    return created;
  };

  for (const event of events) {
    if (event.time < window.since) continue;
    if (event.type === 'turn/start') {
      const payload = event.data as LiriEventMap['turn/start'];
      currentTurn = payload.turn;
      entryOf(currentTurn);
      continue;
    }
    if (event.type === 'turn/quality') {
      const payload = event.data as LiriEventMap['turn/quality'];
      entryOf(payload.turnNumber).score = payload.score;
      continue;
    }
    if (event.type !== 'assistant/tool_call') continue;
    const payload = event.data as LiriEventMap['assistant/tool_call'];
    if (currentTurn === null || !isSkillRun(payload, window.skillName))
      continue;
    entryOf(currentTurn).uses += 1;
  }

  return [...perTurn.entries()]
    .filter(([, value]) => value.uses > 0)
    .map(([turnNumber, value]) => ({
      sessionId,
      turnNumber,
      uses: value.uses,
      score: value.score,
    }))
    .sort((a, b) => a.turnNumber - b.turnNumber);
}

/**
 * 汇总跨会话观测（纯函数）。
 *
 * @param scoreCutoff 低分阈值（生产取 `@modules/evals` 的 `SUSPICIOUS_SCORE_THRESHOLD`，单源）
 */
export function summarizeSopObservations(
  skillName: string,
  turns: readonly SopTurnObservation[],
  scoreCutoff: number
): SopObservation {
  const used = turns.filter((turn) => turn.uses > 0);
  return {
    skillName,
    uses: used.reduce((sum, turn) => sum + turn.uses, 0),
    turns: [...used],
    lowScoreTurns: used.filter(
      (turn) => turn.score !== null && turn.score < scoreCutoff
    ),
    unscoredTurns: used.filter((turn) => turn.score === null),
  };
}

/**
 * 判定（纯函数）。
 *
 * 顺序：**先看低分**（有低分即 `flagged`，即使次数不足）⇒ 再看次数 ⇒ 否则 `supported`。
 */
export function judgeSopObservation(
  observation: SopObservation,
  minUses: number = SOP_OBSERVATION_MIN_USES
): SopObservationJudgement {
  const reasons: string[] = [];
  const describe = (turn: SopTurnObservation) =>
    `${turn.sessionId}#${turn.turnNumber}`;

  if (observation.lowScoreTurns.length > 0) {
    const refs = observation.lowScoreTurns.slice(0, 5).map(describe).join(', ');
    reasons.push(
      `${observation.lowScoreTurns.length} 轮伴随低分（${refs}${observation.lowScoreTurns.length > 5 ? ' …' : ''}）`
    );
    return { verdict: 'flagged', reasons };
  }

  const unscored =
    observation.unscoredTurns.length > 0
      ? `；另有 ${observation.unscoredTurns.length} 轮缺质量事件（未计入）`
      : '';

  if (observation.uses < minUses) {
    reasons.push(
      `观察窗内仅 ${observation.uses} 次执行（需 ≥ ${minUses} 次）${unscored}`
    );
    return { verdict: 'insufficient', reasons };
  }

  reasons.push(`观察窗内 ${observation.uses} 次执行，未见伴随低分${unscored}`);
  return { verdict: 'supported', reasons };
}
