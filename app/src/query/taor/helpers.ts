/**
 * taor/helpers.ts — TAOR 纯助手（续接指令常量 / trace 截断 / 停止原因映射 / steering 注入）
 *
 * 由 `query/TAORLoop.ts` 外迁（大文件拆分，见
 * `.trae/specs/file-size-debt-partition-plan.md` §42）：**只搬不改**（含全部原注释）。
 * 依赖方向：零依赖宿主（仅 `@modules/tasks` / `@modules/context` / `@modules/ai` 类型
 * 与 ReActLoop 的**类型**）⇒ 无循环。
 * 2026-10-08（§1.6 红线审计修复）：追加 steering 注入外迁 —— TAORLoop 基线 1999 行
 * （门禁上限 2000），本次修复的新增逻辑一并外迁至本文件，避免超限。
 */

import { CONTINUATION_TEMPLATES } from '@modules/tasks';
import type { ChatMessage } from '@modules/ai/models/types.js';
import {
  createFragment,
  renderFragment,
  FRAGMENT_KIND_FIELD,
} from '@modules/context';
import type { SteeringEntry, TerminationReason } from '../ReActLoop.js';

/** L3（2026-09-06）：回合质量重试指令 —— **B2-3 收尾迁移（2026-09-23）**：
 *  文案唯一来源改为 `tasks/goal/goalTemplates`（原为"模块自持副本"，理由曾是避免
 *  query→chat 反向依赖；但模板模块位于 `tasks/`（非 chat）⇒ 该理由已不成立，
 *  且两份文案逐字重复属 CS01 违规 —— 见 `.trae/specs/goal-entity.md §5.3.1 #1`）。
 *  batch 无 thinking/finishReason 可靠信号，仅 empty/planning 两类。 */
export const TAOR_EMPTY_RETRY_INSTRUCTION = CONTINUATION_TEMPLATES.empty;
export const TAOR_PLANNING_ONLY_RETRY_INSTRUCTION =
  CONTINUATION_TEMPLATES.planning;
/** planning-only 启发式判定（与 ReActToolLoop.PLANNING_ONLY_RE 同源，保守避免误判正常回答） */
export const TAOR_PLANNING_ONLY_RE =
  /(?:以下(?:是)?(?:我(?:的)?)?(?:执行)?计划|我的计划(?:如下|是)|\bplan(?:\s*:|\s+is|\s+to)\b|步骤\s*[:：]|接下来(?:我)?(?:将|会))/i;

/** trace 持久化用：将值安全截断为 JSON 摘要（默认 500 字符） */
export function truncateForTrace(value: unknown, maxLen = 500): string {
  try {
    const s = JSON.stringify(value);
    if (!s) return '';
    return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
  } catch {
    return String(value).slice(0, maxLen);
  }
}

/**
 * A 档（2026-09-05，复查收口）：TAOR stopReason → 统一 TerminationReason 的纯映射。
 * 显式收口 loop_detected / timeout（对齐 StopHookReason 与骨架枚举），杜绝未知原因
 * 被 default 折叠成 completed 的误判（见 error_repairs 方案 A 记录）。导出便于单测。
 */
export function mapTaorStopReasonToTermination(
  reason: string | null | undefined
): TerminationReason {
  switch (reason) {
    case 'max_turns':
      return 'max_turns';
    case 'budget_exhausted':
      return 'budget_exhausted';
    case 'verifier_escalate':
      return 'verifier_escalate';
    case 'diminishing_returns':
      return 'diminishing_returns';
    case 'loop_detected':
      return 'loop_detected';
    case 'timeout':
      return 'timeout';
    case 'aborted':
      return 'aborted';
    case 'error':
      return 'error';
    default:
      return 'completed';
  }
}

/**
 * Phase 3 Steering 安全过滤器（外迁自 `TAORLoop` 实例字段，**值逐字不变**）：
 * `maxLength` 2000 + 拦截 `system:` / `<|im_start|>` 注入构造。
 */
export const TAOR_STEERING_FILTER = {
  maxLength: 2000,
  blockedPatterns: [/system:\s*/i, /<\|im_start\|>/i],
} as const;

/** steering 入队校验的拒绝原因（`reason` 直接拼进既有日志文案，保持逐字一致） */
export type SteeringRejection =
  | { ok: true }
  | { ok: false; reason: 'too long'; meta: { length: number } }
  | { ok: false; reason: 'blocked content'; meta: { pattern: string } };

/**
 * steering 入队前安全校验（外迁自 `TAORLoop.injectSteering`；**判定与日志文案逐字不变**）。
 * 返回 `reason` 供调用方拼出 `Steering message rejected: <reason>`（与迁移前完全一致）。
 */
export function checkSteeringMessage(
  message: string,
  filter: {
    maxLength: number;
    blockedPatterns: readonly RegExp[];
  } = TAOR_STEERING_FILTER
): SteeringRejection {
  if (message.length > filter.maxLength) {
    return { ok: false, reason: 'too long', meta: { length: message.length } };
  }
  for (const pattern of filter.blockedPatterns) {
    if (pattern.test(message)) {
      return {
        ok: false,
        reason: 'blocked content',
        meta: { pattern: pattern.source },
      };
    }
  }
  return { ok: true };
}

/**
 * `context/steering` 的事件追加通道（最小结构契约，避免依赖 `TAORLoopDeps` 全量）。
 * 与 `ChatEventLogStore.appendStreamEvent` 的形状一致。
 */
export type SteeringEventAppend = (
  sessionId: string,
  event: {
    type: string;
    seq: number;
    time: number;
    sessionId: string;
    data: Record<string, unknown>;
  }
) => Promise<unknown>;

/** TAOR steering 注入依赖（`messages` 为注入目标：TAOR 路径 = 会话消息数组） */
export interface TaorSteeringInjectDeps {
  messages: ChatMessage[];
  appendStreamEvent?: SteeringEventAppend;
  sessionId?: string;
}

/**
 * 注入一批 steering：**先落盘、再注入**（§1.6「模型可见 ⇔ 已落盘」）。
 *
 * 为什么必须先落盘：`[STEERING]` 正文会作为 `role:'user'` 消息进入模型上下文 ⇒
 * 属模型可见输入；修复前只落 logger ⇒ 会话结束后无法从事件日志重建"模型当时看到了哪段
 * steering"（与 `goal/injected` 的 X2 缺口同族）。
 *
 * 顺序即契约，故落盘与注入**同处一个函数**，调用方无法只做一半。
 * 观测面缺失（单测替身未装配）⇒ **如实不落**（不伪造，CS04）；落盘失败**不阻断注入**
 * （属观测面，CS03）。
 */
export async function injectTaorSteering(
  deps: TaorSteeringInjectDeps,
  entries: readonly SteeringEntry[]
): Promise<void> {
  for (const entry of entries) {
    if (deps.appendStreamEvent && deps.sessionId) {
      try {
        // `seq: 0` ⇒ 由 `EventLogStorage.append` 在 mutex 内原子分配（P3-7a 约定）
        await deps.appendStreamEvent(deps.sessionId, {
          type: 'context/steering',
          seq: 0,
          time: Date.now(),
          sessionId: deps.sessionId,
          data: { text: entry.text, source: entry.source },
        });
      } catch {
        // @ignore-catch — 事件落盘属观测面，失败不得中断 steering 注入（CS03）
      }
    }
    // B3-2/CC-06：`[STEERING] ` 由片段类型给出，并写入结构化标记（CS02）
    deps.messages.push({
      role: 'user',
      content: renderFragment(
        createFragment({ kind: 'steering', text: entry.text })
      ),
      [FRAGMENT_KIND_FIELD]: 'steering',
    } as ChatMessage);
  }
}
