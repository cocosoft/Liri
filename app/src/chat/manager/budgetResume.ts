// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * budgetResume — 「预算挂起后的续跑」编排外移（issue #8 · Cut B，2026-10-29）
 *
 * 迁出来源：`ChatManager.ts` 的 `resumeSuspendedSession` / `_resumeSuspendedStream` /
 * `_submitResumeManualConfirmations` / `_markBudgetResumed` / `_resolveReplayForcedTools` /
 * `_isSubstantiveResumeChunk`。依赖一律**显式参数注入**（沿用 `app/src/chat/manager/`
 * 既有做法，**不建全局单例**）。
 *
 * 行为不变红线（issue #8）：不新增配置项、不改默认值、不改事件名。
 * 分流判据、调用顺序、日志文案与返回语义**逐字保持**迁移前状态。
 *
 * ⚠️ 本文件属**崩溃恢复路径**（`code-deletion.md` CD07 关键模块：会话恢复）——
 * 改动必须先有分流决策单测（见 `app/tests/chat/budgetResume.test.ts`）。
 */

import { feature } from '@openliri/kernel';
import { getLogger } from '@modules/monitoring';
import { buildBudgetResumePrompt } from '@modules/query';
import type { PendingToolCallRef } from '@modules/query';
import type { ChatStreamChunk } from '@modules/runtime/api/CoreAPI.js';
import type { EventLogQuery } from '@modules/session';
import type { LiriEvent } from '@modules/session/types/events';
import type { SessionCheckpoint } from '@modules/session/types/checkpoint';
import { StreamingAutoCheckpoint } from '../services/StreamingAutoCheckpoint';
import type { SessionCheckpointService } from '../services/SessionCheckpointService';
import { splitResumePending } from './resumePending';

const logger = getLogger('chat:budgetResume');

/** 续跑所需的 TAOR 检查点最小面（ChatManager 侧为 `TAORLoop`） */
export interface ResumeCheckpointLike {
  id?: string;
  pendingToolCalls?: readonly PendingToolCallRef[] | null;
}

/** 续跑所需的 TAORLoop 最小取用面（ChatManager 侧为 `TAORLoop`） */
export interface TaorResumeLoopLike {
  getCheckpointsForSession(): Promise<ResumeCheckpointLike[] | null>;
  resumeFromCheckpoint(checkpointId?: string): Promise<boolean>;
  /** 本模块只注入一种来源：`durable-resume`（与 `bootstrap.resumePendingSessions` 同源） */
  injectSteering(instruction: string, source: 'durable-resume'): void;
}

export interface BudgetResumeDeps {
  getOrCreateTAORLoop: (sessionId: string) => TaorResumeLoopLike;
  /** 既有执行入口（`ChatOrchestrator.sendMessage` 的 TAOR 委托路径） */
  sendViaOrchestrator: (
    content: string,
    options: { sessionId: string; forcedVisibleTools?: string[] }
  ) => Promise<unknown>;
  getLatestCheckpoint: (sessionId: string) => Promise<SessionCheckpoint | null>;
  resumeStream: (
    sessionId: string,
    checkpointId: string
  ) => AsyncGenerator<string | ChatStreamChunk, unknown, unknown>;
  readSessionEvents: (
    sessionId: string,
    query: EventLogQuery
  ) => Promise<LiriEvent[]>;
  markResumeIntent: (sessionId: string) => void;
  checkpointService: SessionCheckpointService;
}

/**
 * F2 / D7（2026-10-12，预算挂起续跑 Task 3）：挂起会话的「唤醒 → 续跑」入口。
 *
 * - `chain='stream'`：**先试重放、无进展则重发**（C1/I3 口径订正）——见 `resumeSuspendedStream`；
 * - `chain='taor'`：先 `resumeFromCheckpoint(latest)` 恢复游标，再注入续跑 steering
 *   （I4：携带未完成工具清单），最后**触发既有执行入口**（`ChatOrchestrator.sendMessage`
 *   的 TAOR 委托路径）。—— `resumeFromCheckpoint` 只恢复内存状态、**不触发执行**
 *   （spec §3-D7「真再跑」为硬要求），故必须再触发一次既有入口，且**不新增执行路径**。
 *
 * @returns 是否**真正发起**了续跑（两链都"未发生后返回 `false`" ⇒ 协调器保留挂起）
 */
export async function resumeSuspendedSession(
  deps: BudgetResumeDeps,
  sessionId: string,
  chain: 'stream' | 'taor'
): Promise<boolean> {
  if (chain === 'stream') {
    // C1/I3（最终整支评审）：流式链唤醒改为"先试重放、无进展则重发"（见 `resumeSuspendedStream`）。
    return resumeSuspendedStream(deps, sessionId);
  }

  const taorLoop = deps.getOrCreateTAORLoop(sessionId);
  const checkpoints = await taorLoop.getCheckpointsForSession();
  const latest = checkpoints?.[0];
  const latestId = latest?.id;
  const resumed = await taorLoop.resumeFromCheckpoint(latestId);
  if (!resumed) {
    logger.warn('resumeSuspendedSession: 无可用 TAOR 检查点，跳过续跑', {
      sessionId,
    });
    return false;
  }
  // 续跑 steering（与 bootstrap.resumePendingSessions 同源：`durable-resume`）。
  // I4：**消费**挂起检查点落盘的「未完成工具」清单 ⇒ 提示带上尚未完成的工具名/参数摘要；
  // 无清单（历史/首轮即撞限）⇒ 退化为通用续跑提示。
  // T25-13a（2026-10-25）：**非幂等 / 未声明**的未完成工具**不进"请继续"清单**
  // —— 续跑会让模型重发同一调用，而中断未失败 ⇒ `isNonIdempotentRetry` 不匹配 ⇒ 无审批。
  // 改为提交 Inbox 人工确认；若只剩这类工具，则**不自动续跑**（返回 false，协调器保留挂起）。
  const resumeSplit = splitResumePending(latest?.pendingToolCalls);
  if (resumeSplit.manual.length > 0) {
    await submitResumeManualConfirmations(sessionId, resumeSplit.manual);
    if (resumeSplit.replayable.length === 0) {
      logger.info(
        'resumeSuspendedSession: 仅剩非幂等未完成工具 ⇒ 已提交人工确认，不自动续跑',
        {
          sessionId,
          manualTools: [...new Set(resumeSplit.manual.map((p) => p.toolName))],
        }
      );
      return false;
    }
  }
  const resumeInstruction = buildBudgetResumePrompt(resumeSplit.replayable);
  taorLoop.injectSteering(resumeInstruction, 'durable-resume');
  // G-T3-1（2026-10-12）：登记**一次性**续跑意图——委托路径（`ChatOrchestrator.sendMessage`
  // 的 TAOR 分支）会 `taorLoop.reset()`，而 `reset()` 会清 `turnCount` / `resumedFromCheckpoint`
  // / `steeringQueue` ⇒ 刚恢复的游标与 steering 在下一次执行前即被丢弃、"续跑"退化。
  // 必须在触发执行入口**之前**登记（消费点见 `ChatOrchestrator` 的 reset 调用点）。
  deps.markResumeIntent(sessionId);
  // 真再跑：触发既有执行入口（TAOR 委托路径 `ChatOrchestrator.sendMessage`）
  await deps.sendViaOrchestrator(resumeInstruction, { sessionId });
  return true;
}

/**
 * T25-13a（2026-10-25）：续跑前为「非幂等 / 未声明」的未完成工具提交 **Inbox 人工确认**。
 *
 * 为什么走 Inbox：续跑靠"提示模型继续"，而中断的工具**没有失败历史** ⇒ `isNonIdempotentRetry`
 * 不匹配 ⇒ 不会升级审批；因此必须由**人**决定是否重放（复用 `unknown-tool-call-recovery`
 * S3/D3 的既有通道与去重口径，不新增审批机制）。
 *
 * 去重键：`sessionId + toolName`（同一次续跑内同名工具只提一条）。
 * 失败为 **best-effort**（落盘失败只告警，不阻断续跑判定）。
 */
export async function submitResumeManualConfirmations(
  sessionId: string,
  manual: readonly PendingToolCallRef[]
): Promise<void> {
  try {
    const { inboxManager } = await import('../../runtime/InboxManager.js');
    const seen = new Set<string>();
    for (const p of manual) {
      if (seen.has(p.toolName)) continue;
      seen.add(p.toolName);
      await inboxManager.submit({
        sessionId,
        type: 'approval',
        title: `续跑需人工确认：${p.toolName}`,
        message:
          `上次运行中断时工具「${p.toolName}」尚未完成，且它**不是幂等工具**` +
          `（重复执行可能产生重复副作用）。请确认是否需要重放；` +
          `系统**不会**自动重放非幂等 / 未声明工具。`,
        offlineCapable: true,
        source: 'resume-tool-confirm',
        metadata: {
          toolName: p.toolName,
          toolCallId: p.toolCallId,
          reason: 'resume-non-idempotent',
          // 供 InboxManager 判定非"孤儿来源"（与 unknown-tool-recovery 同口径）
          sourceModule: 'budget-resume',
        },
      });
    }
  } catch (error) {
    logger.warn('续跑人工确认提交失败（best-effort）', {
      sessionId,
      error: String(error),
    });
  }
}

/**
 * C1/I3（最终整支评审）：流式链唤醒 —— **先试重放，无实质进展则经既有入口重发一轮**。
 *
 * 事实：日预算闸门在 `ReActLoop.run` 的**轮首、REASON 之前**触发（此刻上一轮 ACT 的工具
 * **已全部完成**）⇒ `resumeStream` 过滤"未完成工具"后剩余为 0，直接 yield `task_all_done`
 * 并 return（不发起新 REASON 轮）⇒ 主链唤醒**退化为空操作**（用户见"放行成功"但任务不走）。
 *
 * 口径（对齐 `daily-budget-over-limit-ux` §5-D-1 D「最简可续跑（重发）」）：
 *  ① 先跑 `resumeStream`（保留既有"重放未完成工具"能力），并判定是否产生**实质进展**；
 *  ② 无实质进展 ⇒ 经**既有**执行入口 `ChatOrchestrator.sendMessage`（与 `taor` 分支同一族）
 *     发起**一次**续跑轮，携带 I4 生成的续跑提示（含未完成工具清单）；
 *  ③ **返回值如实**：真正发起了执行 ⇒ `true`；两次都未发生 ⇒ `false`（协调器据此**保留挂起**）。
 */
export async function resumeSuspendedStream(
  deps: BudgetResumeDeps,
  sessionId: string
): Promise<boolean> {
  // I4：从挂起检查点读出「未完成工具」清单（供"重发一轮"的提示消费；缺失 ⇒ 通用提示）
  const latest = await deps.getLatestCheckpoint(sessionId);
  const pending = (
    latest?.metadata as { pendingToolCalls?: PendingToolCallRef[] } | undefined
  )?.pendingToolCalls;

  // T25-13a（2026-10-25）：按幂等性拆分 —— 非幂等/未声明**不得自动重放**。
  // 注意：下面的 ① `resumeStream` 重放**无法按工具筛选**（它按事件日志重放未完成调用），
  // 故只要存在 manual，就**整段跳过 ①**（宁可少跑，也不重复副作用）。
  const streamSplit = splitResumePending(pending);
  if (streamSplit.manual.length > 0) {
    await submitResumeManualConfirmations(sessionId, streamSplit.manual);
    if (streamSplit.replayable.length === 0) {
      logger.info(
        'resumeSuspendedSession(stream): 仅剩非幂等未完成工具 ⇒ 已提交人工确认，不自动续跑',
        {
          sessionId,
          manualTools: [...new Set(streamSplit.manual.map((p) => p.toolName))],
        }
      );
      return false;
    }
  }

  // ① 先试重放：完整消费生成器（重放本身即"继续执行"，不可提前 break）
  let progressed = false;
  if (streamSplit.manual.length === 0) {
    for await (const chunk of deps.resumeStream(sessionId, '')) {
      if (isSubstantiveResumeChunk(chunk)) progressed = true;
    }
    if (progressed) {
      await markBudgetResumed(sessionId, deps.checkpointService);
      return true;
    }
  }

  // ② 无实质进展 ⇒ 重发一轮（既有执行入口，不新增执行路径）
  // T1-13 / `✅-4` R-A（2026-10-13）：开关开 ⇒ 在**重算工具面之前**注入「重放强制集」
  // （该会话最近一条 `execution/prepared` 快照的 `visibleTools`）⇒ 重放工具面 = 落盘快照，
  // 不受运行期 profile / 注册表变更影响；开关关（逃生）/ 无快照 ⇒ 不注入 ⇒ 等价改造前。
  const forcedVisibleTools = await resolveReplayForcedTools(deps, sessionId);
  try {
    await deps.sendViaOrchestrator(
      buildBudgetResumePrompt(streamSplit.replayable),
      {
        sessionId,
        ...(forcedVisibleTools ? { forcedVisibleTools } : {}),
      }
    );
    await markBudgetResumed(sessionId, deps.checkpointService);
    return true;
  } catch (err) {
    // ③ 重发也失败 ⇒ 如实返回 false（协调器回滚为挂起，不 release）
    logger.warn('resumeSuspendedSession: 流式重发失败，保留挂起', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * 2026-10-17（台账 `BUDGET-SUSPEND-RESTART-IDEMPOTENT`）：放行**续跑成功** ⇒ 落一条
 * 「已从挂起点恢复」轻量检查点（`StreamingAutoCheckpoint.markResumed`）。
 *
 * 为什么需要：挂起事实源 = 检查点（`metadata.budgetSuspend`）、启动扫描据此重建挂起登记；
 * 而此前**没有任何机制让该标记失效** ⇒ 已续跑过的会话在每次重启/重载后又变回「已挂起」
 * （真机实证：同一会话当日被登记 10 次、用户被迫反复点「继续」）。落一条**更新**的检查点后，
 * `ChatBootstrap.resumeBudgetSuspends` 的「只认最新检查点」判据即判定其不再挂起。
 *
 * 与「重放/重发**均失败** ⇒ 不落标记（协调器回滚为挂起）」对称 —— 只有**真续跑**才算恢复。
 * 失败仅告警（CS03：登记面失败不得反过来把一次成功的续跑判成失败）。
 */
export async function markBudgetResumed(
  sessionId: string,
  checkpointService: SessionCheckpointService
): Promise<void> {
  try {
    await new StreamingAutoCheckpoint(
      checkpointService,
      sessionId
    ).markResumed();
  } catch (err) {
    logger.warn('resumeSuspendedSession: 落「已恢复」标记失败（续跑已成功）', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * T1-13 / `✅-4`（R-A，2026-10-13）：解析「**重放强制可见集**」——受 `PREPARED_SNAPSHOT_REPLAY`（**默认开**）。
 *
 * 开关关（逃生）⇒ **不读事件日志**、返回 `undefined`（零开销、等价改造前）；开（默认）⇒ 读该会话最近一条
 * `execution/prepared` 快照的 `visibleTools`（无快照 ⇒ `undefined`，**不臆造**）。
 * 读取失败只留痕（CS03：不把观测面失败升级为续跑失败）。
 * 见 `.trae/specs/execution-prepared-snapshot-persistence.md` §11 R-A。
 */
export async function resolveReplayForcedTools(
  deps: BudgetResumeDeps,
  sessionId: string
): Promise<string[] | undefined> {
  if (!feature('PREPARED_SNAPSHOT_REPLAY')) return undefined;
  try {
    const { resolveReplayVisibleTools } = await import('@modules/execution');
    // 只读该类型事件（每执行一条 ⇒ 结果集极小；`limit` 取上限以覆盖长会话）
    const events = await deps.readSessionEvents(sessionId, {
      types: ['execution/prepared'],
      limit: 10000,
    });
    return resolveReplayVisibleTools(events) ?? undefined;
  } catch (e) {
    // @ignore-catch — 强制集读取失败不影响续跑（CS03），已 warn
    logger.warn('PREPARED 快照重放：读取落盘快照失败，按现状续跑', {
      sessionId,
      error: String(e),
    });
    return undefined;
  }
}

/**
 * C1：判定 `resumeStream` 产出的 chunk 是否代表**实质进展**。
 *
 * 非实质 = `error`（打不开检查点等）或 `status/task_all_done`（无剩余工具、空操作）。
 * 其余（文本增量 / reasoning / 工具事件 / `status/resume`）均视为真正推进了执行。
 */
export function isSubstantiveResumeChunk(
  chunk: string | ChatStreamChunk
): boolean {
  if (typeof chunk === 'string') return chunk.length > 0;
  const c = chunk as { type?: string; statusType?: string };
  if (c.type === 'error') return false;
  if (c.type === 'status' && c.statusType === 'task_all_done') return false;
  return true;
}
