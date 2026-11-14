// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * G2（2026-11-13）：失败归因 → 自适应路由的**判定纯函数**（默认关、未接线）。
 *
 * 依据：`dev_docs/20261112/T2-T3-20261112.md` §T2 的接口草案与 10 条负向对照用例。
 * 本期只落地 **A 档（`reflect`：下一轮注入一次反思提示）**；B 档 `switch-model` 待
 * §T2.6 Q1 拍板后再加（届时复用同一入口与同一每任务计数，不在本文件外另起判定）。
 *
 * 纪律（与草案一致）：
 * - **零 IO、零副作用**：开关是否打开由组合根读 `MODEL_FALLBACK_ON_LOOP` 后传 `enabled`，
 *   函数本身不读 `process.env`、不写日志 ⇒ 单测可穷举；
 * - **关 ⇒ 恒 `none`**：调用点在开关关闭时不得产生任何额外计算/记录（T2.4 生效语义）；
 * - **不越权**：用户显式指定模型、本回合已注入软纠偏、每任务已达上限 ⇒ 一律不触发。
 */
import type { TerminationReason } from '../ReActLoop.js';

/**
 * 可触发回退的归因（仅这两项）。
 *
 * `io_loop` / `no_tool_call` 自 P0-3 起已从 `aborted` 单独拆出
 * （见 `ReActLoop.ts` 的 `TerminationReason`），因此判定不需要另建检测器。
 */
export type LoopFallbackReason = Extract<
  TerminationReason,
  'io_loop' | 'no_tool_call'
>;

/**
 * 回退动作。
 *
 * 本期只产出 `reflect`；`none` 表示"不做任何事"（绝大多数输入）。
 */
export type LoopFallbackAction = 'none' | 'reflect';

export interface LoopFallbackDecision {
  action: LoopFallbackAction;
  /** 仅解释用，**不得**用于状态判定（CS02） */
  reason?: LoopFallbackReason;
}

export interface LoopFallbackInput {
  /** 灰度开关 `MODEL_FALLBACK_ON_LOOP` 的当前值（默认 `false`） */
  enabled: boolean;
  /** 本回合的终止归因（只认 `io_loop` / `no_tool_call`） */
  terminationReason: TerminationReason;
  /**
   * 本回合是否已注入软纠偏（steering）。
   *
   * `true` ⇒ 让路一轮：仓内既有两条"软纠偏优先于硬熔断"的通道
   * （文件 IO 预警分支、`no_progress` 软纠偏），自动回退必须排在它们之后（T2.5 #3/#4）。
   */
  steeringInjectedThisTurn: boolean;
  /** 同一任务内已执行过的回退次数（`reflect` 注入与将来 `switch-model` 共用） */
  fallbackCountInTask: number;
  /** 会话是否显式指定模型（`true` ⇒ 尊重用户选择，不越权改写路由，T2.5 #9） */
  userPinnedModel: boolean;
}

/**
 * 每任务回退上限（T2.5 #8）：防"换模型/反复反思"死循环。
 *
 * 计数须随任务 checkpoint 走（将来接线时的持久化要求，见 T2.6 选项 B 的代价）。
 */
export const MAX_LOOP_FALLBACKS_PER_TASK = 1;

/** 触发归因集合（唯一事实源，禁止在别处再列一遍） */
const LOOP_FALLBACK_REASONS: ReadonlySet<TerminationReason> =
  new Set<TerminationReason>(['io_loop', 'no_tool_call']);

function isLoopFallbackReason(
  reason: TerminationReason
): reason is LoopFallbackReason {
  return LOOP_FALLBACK_REASONS.has(reason);
}

/**
 * 判定是否需要对本次终止做回退。
 *
 * 判定顺序即优先级：开关 → 归因 → 软纠偏让路 → 用户显式选择 → 每任务上限。
 * 任一守卫命中都返回 `{ action: 'none' }`，**不带** `reason`（避免调用方把
 * "被抑制"误读成"已归因"）。
 */
export function decideLoopFallback(
  input: LoopFallbackInput
): LoopFallbackDecision {
  if (!input.enabled) return { action: 'none' };
  if (!isLoopFallbackReason(input.terminationReason)) return { action: 'none' };
  if (input.steeringInjectedThisTurn) return { action: 'none' };
  if (input.userPinnedModel) return { action: 'none' };
  if (input.fallbackCountInTask >= MAX_LOOP_FALLBACKS_PER_TASK) {
    return { action: 'none' };
  }
  return { action: 'reflect', reason: input.terminationReason };
}
