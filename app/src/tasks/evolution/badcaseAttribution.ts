// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 学习反馈闭环 S2：轮次归因（2026-11-15，M1）
 *
 * 规格：`.trae/specs/learning-feedback-loop.md` §3-S2 / §5-M1。
 *
 * **只做"把低分翻译成类别"这一件事**，且判据全部来自**结构化字段**（`turn/quality` 载荷的
 * `components` / `signals` / `review`，CS02：禁按文案推断）。三条硬约束：
 * - **纯函数**：不读文件、不调模型、不写事件（可单测、可回放）；
 * - **证据随行**：每条结论都带 `evidence[]`，评审能看到"为什么是这一类"；
 * - **无模型兜底**：类别不明时落到 `low_value_answer`（低置信度），不假装精确。
 *
 * M1 的类别集合是 5 个；`repeated_question` **暂不实现** —— 它需要"同题配对"的结构化信号
 * （现有事件只有 `replyToId` / `questionId`，不构成"重复提问"判定），按 CS02 不做文案相似度猜测。
 */

import type { LiriEvent, LiriEventType } from '@modules/session/types/events';
import type { LiriEventMap } from '@modules/session/types/eventPayloads';

/** `turn/quality` 事件载荷（取自事件契约，**不复制形状**） */
export type TurnQualityPayload = LiriEventMap['turn/quality'];

/** 归因类别（六类；语义见 spec §3-S2 / §5-M10） */
export type BadcaseCategory =
  | 'tool_failure'
  | 'retry_loop'
  | 'budget_exhausted'
  | 'verifier_reject'
  | 'repeated_question'
  | 'low_value_answer';

/** 该轮的工具观测（由 `assistant/tool_call` + `tool/result` 配对得到） */
export interface AttributionToolObservation {
  name: string;
  ok: boolean;
  /** 结构化错误码（来自工具结果，可选） */
  errorCode?: string;
}

/** 归因输入 */
export interface AttributionInput {
  quality: TurnQualityPayload;
  /** 该轮工具观测；缺省 ⇒ 跳过工具类判定（不猜） */
  tools?: readonly AttributionToolObservation[];
  /**
   * 重复提问信号（M10）：由 `user/message.replyToId` 派生 —— 同一 assistant 回答被第 N 条
   * 用户消息指向（N ≥ 2）时，该用户消息触发的轮次记为重复提问。
   *
   * 缺省 ⇒ 不判定（不猜）；只认结构化字段，不做文本相似度（CS02）。
   */
  repeat?: { replyCount: number };
}

/** 归因结果 */
export interface AttributionResult {
  category: BadcaseCategory;
  /** 0..1；规则越强越高（不参与阈值门禁，仅供排序/展示） */
  confidence: number;
  /** 结构化证据（人工复核用；禁止在此放自由文本推测） */
  evidence: string[];
}

/** 复核器的拒绝判据（与 `VerifierAgent` 三态同源；只比对枚举值） */
const VERDICT_REJECT = 'REJECT';
/** 工具反复度软阈：低于此值且调用数够多才算"打转"（`components.toolThrash` 为 1 表示无反复） */
const TOOL_THRASH_CUTOFF = 0.5;
/** 触发"打转"判定所需的最少工具调用数（低于此数属正常多步任务） */
const MIN_TOOL_CALLS_FOR_THRASH = 6;

/** 判为「重复提问」所需的最少指向次数（同一 assistant 回答被 ≥2 条用户消息指向） */
const REPEAT_REPLY_MIN_COUNT = 2;

/** 分数格式（证据里保留两位，便于人工比对） */
function fixed2(value: number): string {
  return value.toFixed(2);
}

/**
 * 轮次归因（纯函数）。
 *
 * 判定顺序（前一条命中即返回，顺序即优先级）：
 * ① 复核 `REJECT` ⇒ `verifier_reject`
 * ② 有工具失败 ⇒ `tool_failure`
 * ③ `aborted` 且复核因预算跳过 ⇒ `budget_exhausted`
 * ④ 工具反复度低且调用数多 ⇒ `retry_loop`
 * ⑤ 其余 ⇒ `low_value_answer`（置信度随分数降低而升高）
 */
export function attributeBadcase(input: AttributionInput): AttributionResult {
  const { quality, tools = [] } = input;
  const evidence: string[] = [
    `score=${fixed2(quality.score)}`,
    `status=${quality.signals.status}`,
    `toolCalls=${quality.signals.toolCalls}`,
  ];

  if (quality.review?.verdict === VERDICT_REJECT) {
    evidence.push(`verdict=${VERDICT_REJECT}`);
    return { category: 'verifier_reject', confidence: 0.9, evidence };
  }

  const failed = tools.filter((t) => !t.ok);
  if (failed.length > 0) {
    evidence.push(
      `tools_failed=${failed
        .map((t) => (t.errorCode ? `${t.name}:${t.errorCode}` : t.name))
        .join(',')}`
    );
    return { category: 'tool_failure', confidence: 0.85, evidence };
  }

  if (
    quality.signals.status === 'aborted' &&
    quality.reviewSkipped === 'budget'
  ) {
    evidence.push('review=budget-skipped');
    return { category: 'budget_exhausted', confidence: 0.7, evidence };
  }

  // M10：同一回答被 ≥2 条用户消息追问 ⇒ 用户已在用行为表达"上一轮没答好"
  if (input.repeat && input.repeat.replyCount >= REPEAT_REPLY_MIN_COUNT) {
    evidence.push(`reply_to_same_answer=${input.repeat.replyCount}`);
    return { category: 'repeated_question', confidence: 0.8, evidence };
  }

  if (
    quality.components.toolThrash < TOOL_THRASH_CUTOFF &&
    quality.signals.toolCalls >= MIN_TOOL_CALLS_FOR_THRASH
  ) {
    evidence.push(`toolThrash=${fixed2(quality.components.toolThrash)}`);
    return { category: 'retry_loop', confidence: 0.75, evidence };
  }

  evidence.push(
    `completion=${fixed2(quality.components.completion)}`,
    `cost=${fixed2(quality.components.cost)}`
  );
  const s = Math.min(Math.max(quality.score, 0), 1);
  return {
    category: 'low_value_answer',
    confidence: 0.3 + (1 - s) * 0.4,
    evidence,
  };
}

/**
 * 把一段事件序列折算成"每轮的工具观测"（纯函数）。
 *
 * 口径：`assistant/tool_call`（带 `callSeq`）与 `tool/result`（带 `callSeq` + `isError`）
 * 按 `callSeq` 配对；配对不到的调用**不计**（不猜成败）。轮次归属由最近的 `turn/start`
 * 决定（事件必须按 `seq` 升序传入）。无 `turn/start` 前缀的事件归 `0` 号（表示未知轮）。
 */
export function collectTurnToolObservations(
  events: readonly LiriEvent[]
): Map<number, AttributionToolObservation[]> {
  const byTurn = new Map<number, AttributionToolObservation[]>();
  const nameByCallSeq = new Map<number, string>();
  let currentTurn = 0;

  for (const event of events) {
    if (event.type === 'turn/start') {
      currentTurn = dataAs(event, 'turn/start').turn;
      continue;
    }
    if (event.type === 'assistant/tool_call') {
      const call = dataAs(event, 'assistant/tool_call');
      if (typeof call.callSeq === 'number') {
        nameByCallSeq.set(call.callSeq, call.name);
      }
      continue;
    }
    if (event.type === 'tool/result') {
      const result = dataAs(event, 'tool/result');
      const name = nameByCallSeq.get(result.callSeq);
      if (!name) continue;
      const list = byTurn.get(currentTurn) ?? [];
      list.push({
        name,
        ok: result.isError !== true,
      });
      byTurn.set(currentTurn, list);
    }
  }
  return byTurn;
}

/**
 * 按已判定的 `type` 取载荷。
 *
 * `LiriEvent` 的 `data` 是**联合类型**（`type` 字段不参与判别收窄）⇒ 这里在
 * `if (event.type === '…')` 之后做一次显式收窄；判定依据仍是 `type`（CS02）。
 */
function dataAs<T extends LiriEventType>(
  event: { data: unknown },
  _type: T
): LiriEventMap[T] {
  return event.data as LiriEventMap[T];
}
