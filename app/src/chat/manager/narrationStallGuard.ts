// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * narrationStallGuard —— 「纯叙事空转」判定（2026-11-20，只读取证后落地）
 *
 * ## 要解决的问题
 * 目标/编排循环的自动续跑（`idleContinuation` / 启动期目标续接）会把会话从一条纯叙事
 * assistant 消息继续喂下一轮「继续」，而模型可以**一直只说不做**：
 * 本机取证（`01_work/tmp-goal-drift.ts`）显示单会话出现 39–40 条连续纯叙事，
 * 累计 6.97M tokens，且这些长连击**从不以工具调用结束**（71 段里 0 段），
 * 只被下一次续跑注入或会话结束打断。现有 `no_progress_streak` 对这种形态**完全不触发**（实测恒为 0）。
 *
 * ## 判据（CS02：只看结构化字段，不看文案）
 * 从尾部回溯，累计「assistant 且 `metadata.tool_calls` 为空」的消息条数：
 * - **系统续跑注入**（user + `metadata.systemResume === true`）**不打断**计数
 *   —— 它只是把同一条空转切成多段（实测 254 条注入 vs 2 条人工消息）；
 * - **编排回写的任务进度消息**（`metadata.isTaskMessage === true`）同样**既不计数也不打断**
 *   —— 它们不是模型轮次；计入会造成误报（真机实测：计入 run=11 / 排除 run=2）；
 * - 其余一切（带 `tool_calls` 的 assistant、tool 消息、人工 user 消息、system）都**打断**。
 *
 * ## 阈值
 * `NARRATION_STALL_LENGTH = 6`：本机分布是**双峰**——正常态集中在 1–4 条（342 段），
 * **5–6 条零样本**，失控态集中在 ≥7 条（79 段）⇒ 取 6 落在天然断层上，现有样本零误伤。
 *
 * ## 豁免
 * 「合法的只说不做」在本仓都是**工具调用轮**（`ask_user_question` / `plan` / `todo_write` 等），
 * 带 `tool_calls` ⇒ 天然打断计数，**无需**额外豁免标记。
 */

// 角色枚举的唯一来源（避免裸字面量：`lint:consts-bare` 棘轮）
import { MessageRole } from '@modules/session/types/UnifiedMessage';

/** 触发暂停的连续纯叙事**条数**（落在分布断层上；见文件头取证） */
export const NARRATION_STALL_LENGTH = 6;

/** 判定所需的最小消息形状（只读这几个字段；便于纯函数单测） */
export interface NarrationGuardMessage {
  role?: string;
  metadata?: {
    tool_calls?: unknown;
    systemResume?: unknown;
    isTaskMessage?: unknown;
  };
}

/** 是否「纯叙事」：assistant 且没有声明任何工具调用 */
export function isNarrationMessage(m: NarrationGuardMessage): boolean {
  if (m.role !== MessageRole.ASSISTANT) return false;
  const calls = m.metadata?.tool_calls;
  return !Array.isArray(calls) || calls.length === 0;
}

/** 是否「系统续跑注入」（不是人工检查点，不打断空转计数） */
export function isSystemResumeMessage(m: NarrationGuardMessage): boolean {
  return m.role === MessageRole.USER && m.metadata?.systemResume === true;
}

/**
 * 是否「编排回写的任务进度消息」（`metadata.isTaskMessage === true`）。
 *
 * 这类消息由 PDCA/LRO 循环把任务进度写进会话投影，**不是模型轮次** ⇒ 既不计数也不打断。
 * 漏掉这条会造成**误报**：真机实测某目标会话计入后 run=11、排除后 run=2（2026-11-20）。
 */
export function isTaskProgressMessage(m: NarrationGuardMessage): boolean {
  return m.metadata?.isTaskMessage === true;
}

/**
 * 从尾部回溯，返回**连续纯叙事**的条数。
 *
 * 跳过（既不计数也不打断）：系统续跑注入、编排回写的任务进度消息；
 * 其余（带 `tool_calls` 的 assistant、tool 消息、人工 user、system）一律打断。
 *
 * @param messages 会话消息（按时间正序）
 */
export function countTrailingNarrationRun(
  messages: readonly NarrationGuardMessage[]
): number {
  let run = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (isTaskProgressMessage(m)) continue;
    if (isNarrationMessage(m)) {
      run++;
      continue;
    }
    if (isSystemResumeMessage(m)) continue;
    break;
  }
  return run;
}

/** 是否已达「空转」判定（默认阈值 6） */
export function isNarrationStalled(
  messages: readonly NarrationGuardMessage[],
  threshold: number = NARRATION_STALL_LENGTH
): boolean {
  return countTrailingNarrationRun(messages) >= threshold;
}

/**
 * 读取 + 判定的组合入口（**可注入读者**，便于在不 mock 模块的前提下单测接线语义）。
 *
 * 读失败 ⇒ 按**未触发**返回（诊断路径的 IO 问题不得阻断重启/idle 续跑），并通过 `onReadError` 上报；
 * 调用方（`ChatRecovery`）只负责传入 `gateway.getMessages` 与 `logger.warn`。
 */
export async function inspectNarrationStall(params: {
  sessionId: string;
  readMessages: (
    sessionId: string
  ) => Promise<readonly NarrationGuardMessage[]>;
  onReadError?: (sessionId: string, error: unknown) => void;
  threshold?: number;
}): Promise<{ stalled: boolean; run: number }> {
  try {
    const messages = await params.readMessages(params.sessionId);
    const run = countTrailingNarrationRun(messages);
    return {
      stalled: run >= (params.threshold ?? NARRATION_STALL_LENGTH),
      run,
    };
  } catch (err) {
    // @ignore-catch 诊断读取失败不阻断正常续跑（CS03：回退须留痕，由 onReadError 记录）
    params.onReadError?.(params.sessionId, err);
    return { stalled: false, run: 0 };
  }
}
