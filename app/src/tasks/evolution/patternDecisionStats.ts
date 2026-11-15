// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 编排模式决策的只读统计（2026-11-15）
 *
 * 规格：`.trae/specs/self-verify-turn-surface.md`（`#4` 生效面前移）+
 * `.trae/specs/default-off-switches-review-gates.md` §2 #11 / §3-O5（判据①：`verify` 意图命中 ≥20 会话）。
 *
 * **只读、纯函数**：输入「会话 → 事件」，输出按 `sessionId` **去重**的命中与会话数，
 * 不改任何状态、不落盘、不调模型。数据源是既有 `pattern/decision` 事件
 * （`site='turn_dispatch'` 轮首判定 / `'research_dispatch'` PDCA 研究分流）——不新增埋点（CS01）。
 */

import type { LiriEvent } from '@modules/session/types/events';
import type { LiriEventMap } from '@modules/session/types/eventPayloads';

/** 判据① 阈值：`verify` 意图命中的**会话数**（登记表 §2 #11） */
export const PATTERN_DECISION_GATE_MIN_SESSIONS = 20;

/** 验证线路的两个模式名（同一 `verify` route 的两档：标准 / deep） */
const SELF_VERIFY_PATTERN = 'self_verify';
const REFINE_PATTERN = 'iterative_refine';
/** 研究分流模式（另一条 route；单独计数，不计入判据①） */
const RESEARCH_PATTERN = 'competitive_strategy';

/** 单个会话的待统计输入 */
export interface PatternDecisionSessionInput {
  sessionId: string;
  events: readonly LiriEvent[];
}

/** 统计结果（全部为**会话去重**口径；`decisionEvents` 为事件条数） */
export interface PatternDecisionSummary {
  /** 扫描到的会话数（含无决策事件者） */
  sessionsScanned: number;
  /** 含至少一条 `pattern/decision` 的会话数 */
  sessionsWithDecision: number;
  /** `pattern/decision` 事件总条数 */
  decisionEvents: number;
  /** 验证线路命中的会话数（= self_verify ∪ iterative_refine，判据① 的分子） */
  verifySessions: number;
  /** 其中 `self_verify` 命中会话数 */
  selfVerifySessions: number;
  /** 其中 `iterative_refine` 命中会话数 */
  refineSessions: number;
  /** 验证线路中**实际启用**（`applied=true`）的会话数 */
  appliedSessions: number;
  /** 研究分流命中的会话数 */
  researchSessions: number;
  /** 判定时刻门控为开（`featureGate.enabled=true`）的会话数 */
  gateEnabledSessions: number;
  /** 判据① 是否已达阈值 */
  meetsGateThreshold: boolean;
}

/** 决策事件载荷（取自契约，不复制形状） */
type DecisionPayload = LiriEventMap['pattern/decision'];

/**
 * 汇总 `pattern/decision`（纯函数）。
 *
 * 口径：按 `sessionId` **去重**计数 —— 同一会话多轮命中只算一个会话（与登记表 §3-O5 一致）；
 * 只认结构化字段（`selected` / `applied` / `featureGate.enabled`），不做文案推断（CS02）。
 */
export function summarizePatternDecisions(
  sessions: readonly PatternDecisionSessionInput[]
): PatternDecisionSummary {
  const selfVerify = new Set<string>();
  const refine = new Set<string>();
  const applied = new Set<string>();
  const research = new Set<string>();
  const gateEnabled = new Set<string>();
  const withDecision = new Set<string>();
  let decisionEvents = 0;

  for (const { sessionId, events } of sessions) {
    for (const event of events) {
      if (event.type !== 'pattern/decision') continue;
      const data = event.data as DecisionPayload;
      decisionEvents += 1;
      withDecision.add(sessionId);
      if (data.selected === SELF_VERIFY_PATTERN) selfVerify.add(sessionId);
      if (data.selected === REFINE_PATTERN) refine.add(sessionId);
      if (data.selected === RESEARCH_PATTERN) research.add(sessionId);
      if (data.applied === true) applied.add(sessionId);
      if (data.featureGate?.enabled === true) gateEnabled.add(sessionId);
    }
  }

  const verify = new Set<string>([...selfVerify, ...refine]);
  return {
    sessionsScanned: sessions.length,
    sessionsWithDecision: withDecision.size,
    decisionEvents,
    verifySessions: verify.size,
    selfVerifySessions: selfVerify.size,
    refineSessions: refine.size,
    appliedSessions: applied.size,
    researchSessions: research.size,
    gateEnabledSessions: gateEnabled.size,
    meetsGateThreshold: verify.size >= PATTERN_DECISION_GATE_MIN_SESSIONS,
  };
}
