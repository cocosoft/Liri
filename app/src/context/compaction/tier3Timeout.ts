/**
 * Tier3 超时编排（P1-2，2026-11-04，《运行态问题排查与修复方案》）
 *
 * 原实现超时后**立即**返回 `{applied:false}`，把内层已经折叠完成的批次一起丢掉
 * （折叠循环在批边界检查 abort signal，通常毫秒级就能带着部分结果返回）
 * ⇒ 长会话压缩"跑了 60 秒什么也没留下"，只能回退 tier2 / 截断。
 *
 * 本模块把"主超时 + 收敛宽限"抽成独立纯编排（计时参数可注入，便于用毫秒级用例覆盖）：
 * 1. 主超时到点 ⇒ 调用方给的 `abort()` 中断 LLM 请求；
 * 2. 再给 `graceMs` 等内层收尾，返回 `applied:true` 的部分结果就采纳；
 * 3. 宽限内仍拿不到可用结果 ⇒ 回退调用方给的 fallback（保留 tier2 结果）。
 */

import type { ChatMessage } from '@modules/ai';
// 2026-11-08：类型从 `./compactionOutcome`（纯类型 leaf）取，
// 不再反向 import 编排器 —— 原写法构成 `CompactionOrchestrator ↔ tier3Timeout` 循环
// （CI `madge --circular` 基线 0，阻断）。
import type { CompactionOutcome } from './compactionOutcome';

export interface Tier3TimeoutParams {
  /** 内层压缩（已带 abort signal） */
  work: Promise<CompactionOutcome>;
  /** 主超时到点时的中断动作（通常 `abortCtrl.abort()`） */
  abort: () => void;
  /** 主超时上限（毫秒） */
  timeoutMs: number;
  /** 超时后等待内层收敛的宽限（毫秒） */
  graceMs: number;
  /** 回退结果：`messages` 为**进入 tier3 前**的消息（即 tier2 结果） */
  fallbackMessages: ChatMessage[];
}

export interface Tier3TimeoutResult {
  outcome: CompactionOutcome;
  /** 主超时是否触发 */
  timedOut: boolean;
  /** 超时后是否采纳了内层的部分结果（`applied:true`） */
  keptPartial: boolean;
}

export async function runTier3WithTimeout(
  params: Tier3TimeoutParams
): Promise<Tier3TimeoutResult> {
  const { work, abort, timeoutMs, graceMs, fallbackMessages } = params;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const winner = await Promise.race([
    work.then((result) => ({ kind: 'done' as const, result })),
    new Promise<{ kind: 'timeout' }>((resolve) => {
      timeoutId = setTimeout(() => {
        abort();
        resolve({ kind: 'timeout' });
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
  if (winner.kind === 'done') {
    return { outcome: winner.result, timedOut: false, keptPartial: false };
  }

  // 主超时已触发并 abort：给内层一个收敛窗口，保留**已完成**的折叠批次
  let graceId: ReturnType<typeof setTimeout> | undefined;
  const settled = await Promise.race([
    work,
    new Promise<null>((resolve) => {
      graceId = setTimeout(() => resolve(null), graceMs);
    }),
  ]).finally(() => {
    if (graceId !== undefined) clearTimeout(graceId);
  });

  if (settled?.applied) {
    return { outcome: settled, timedOut: true, keptPartial: true };
  }
  return {
    outcome: { messages: fallbackMessages, applied: false },
    timedOut: true,
    keptPartial: false,
  };
}
