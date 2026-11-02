/**
 * 统一 effects 队列 —— 类型契约（P38，2026-11-02）
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 P38。
 * 参考：`dsh:src/app/effects.ts` 全文、`dsh:docs/003-execution.md:153-161`。
 *
 * 目标：把三套分域台账（投递 / 结算 / 通知…）收敛成**一个**「先落库、提交后派发」的队列，
 * 并补齐参考实现验证过的三条语义：
 * 1. `later`：暂停 / 槽位满 ⇒ 只按初始延迟重排，**不计失败**；
 * 2. `generation`：同 `(kind, key)` 更新即 `generation+1` ⇒ **旧尝试不得删除新载荷**；
 * 3. `FAILURES_BEFORE_ERROR = 3`：同类连续失败 3 次才升级为系统问题（此前每次失败都报错）。
 *
 * 本文件只有类型与常量：无 IO、不 import 任何具体业务域。
 */

/**
 * effect 类别（P38 先覆盖 6 类；Liri 等价物见括号）。
 *
 * - `assessment`（目标达成自评 / 审查结论）
 * - `launch`（派工 / 启动下一次执行）
 * - `delivery`（出站投递）
 * - `relay`（跨通道/跨会话转投）
 * - `notice`（主动通知）
 * - `reply`（对入站消息的回复）
 */
export const EFFECT_KINDS = [
  'assessment',
  'launch',
  'delivery',
  'relay',
  'notice',
  'reply',
] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];

/**
 * 队列条目状态（`lint:state-ratchet` Register-or-Fail）。
 *
 * ⚠️ 取值**一律带 `effect_` 前缀**：`pending / settled / failed` 是跨域通用词，
 * 直接登记会把其它域既有的 `settled` 出现点一并划入词汇表（P33 的 `step_` 同款教训）
 * ⇒ 用域前缀隔离本表词汇。
 */
export const EFFECT_STATUSES = [
  'effect_pending',
  /** P38-b：已发出、结果未知（崩溃后**不得**当作"未发出"重投） */
  'effect_attempting',
  'effect_settled',
  'effect_failed',
] as const;
export type EffectStatus = (typeof EFFECT_STATUSES)[number];

/**
 * 状态字面量的唯一事实源（SQL/比较处必须引用，禁止裸写）。
 *
 * 用 `satisfies` 而非 `: EffectStatus` ⇒ 保留**字面量类型**，计算属性
 * `Record<EffectStatus, number>` 才能被 TS 认定为完整键集。
 */
export const EFFECT_STATUS_PENDING = 'effect_pending' satisfies EffectStatus;
export const EFFECT_STATUS_ATTEMPTING =
  'effect_attempting' satisfies EffectStatus;
export const EFFECT_STATUS_SETTLED = 'effect_settled' satisfies EffectStatus;
export const EFFECT_STATUS_FAILED = 'effect_failed' satisfies EffectStatus;

/**
 * 每类 effect 的失败上限（缺省 `EFFECT_FAILURES_BEFORE_ERROR` = 3）。
 *
 * `reply` 取 8：与渠道回传现状一致（外部瞬时故障多见，收紧到 3 会显著提高未送达率）。
 * 显式登记，不做隐性例外。
 */
export const EFFECT_KIND_MAX_ATTEMPTS: Readonly<
  Partial<Record<EffectKind, number>>
> = { reply: 8 };

/** 一次派发的结论（由消费方返回） */
export type EffectOutcome =
  /** 成功：本条结束 */
  | { kind: 'done' }
  /** 推迟：**不计失败**，只把 due 前移（暂停/槽位满） */
  | { kind: 'later'; retryAt?: number }
  /** 失败：累计 attempts，连续 `FAILURES_BEFORE_ERROR` 次才升级 */
  | { kind: 'failed'; error?: string };

/**
 * `EffectOutcome.kind` 的**值位置**唯一事实源。
 *
 * `failed` 是跨域通用词：其它文件裸写会被 `lint:state-ratchet` 判为"未报备状态字面量"
 * （本文件是 `effectQueue` 状态机的登记源，值字面量在此集中定义）。
 */
export const EFFECT_OUTCOME_DONE = 'done';
export const EFFECT_OUTCOME_LATER = 'later';
export const EFFECT_OUTCOME_FAILED = 'failed';

/** 队列中的一条 effect（读侧视图） */
export interface EffectEntry {
  kind: EffectKind;
  key: string;
  payload: Record<string, unknown>;
  /** 载荷代次：同键每次 `enqueue` +1（防旧尝试覆盖新载荷） */
  generation: number;
  status: EffectStatus;
  /** 连续失败次数（`later` 不增；成功/新载荷归零） */
  attempts: number;
  /** 最早可派发时刻（epoch ms） */
  dueAt: number;
  /** 最近一次领取时刻（`effect_attempting` 的陈旧判定输入；未领取过 ⇒ 缺省） */
  claimedAt?: number;
  /** 本次是"崩溃后重投"（对端据此带可见标记，避免重复副作用） */
  restored?: boolean;
  lastError?: string;
  createdAt: number;
  updatedAt: number;
}

/** `claimOne()` 的结果（并发下只有一个胜者） */
export interface ClaimEffectResult {
  claimed: boolean;
  generation?: number;
  /** 是否为"崩溃后重投"（此前已是 `effect_attempting` 且超过陈旧窗口） */
  restored?: boolean;
  payload?: Record<string, unknown>;
  /** 当前已累计的失败次数（领取不增加） */
  attempts?: number;
}

/** 领取到的一条待派发任务（携带 `generation` 供结算时比对） */
export interface ClaimedEffect extends EffectEntry {
  /** 领取时刻（审计用） */
  claimedAt: number;
}

// 数值常量下沉 `@openliri/infra/constants`（单一时长事实源；`lint:consts-bare` 要求）
import {
  EFFECT_MAX_RETRY_MS,
  EFFECT_RETRY_BASE_MS,
} from '@openliri/infra/constants';

export {
  EFFECT_CLAIM_STALE_MS,
  EFFECT_DEFAULT_LATER_MS,
  EFFECT_FAILURES_BEFORE_ERROR,
  EFFECT_MAX_RETRY_MS,
  EFFECT_RETRY_BASE_MS,
} from '@openliri/infra/constants';

/** 计算失败退避（`attempts` 为**本次失败后**的累计次数，从 1 起） */
export function effectRetryDelay(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(
    EFFECT_RETRY_BASE_MS * Math.pow(2, exponent),
    EFFECT_MAX_RETRY_MS
  );
}
