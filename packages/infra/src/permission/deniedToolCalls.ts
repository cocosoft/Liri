// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * deniedToolCalls —— 用户「拒绝」某次工具调用的**会话内事实**（2026-11-12）
 *
 * **问题**：审批卡点「拒绝」后只把 Inbox 项置为已处理，既不给该调用写终态结果、也不续跑
 * ⇒ 模型永远收不到"被拒绝"，会话停在「等待审批」（真机 `session_mwd6c9ui384f78c969`）。
 *
 * **做法**：拒绝时按 `sessionId + toolCallId` 记一笔；续跑重放该调用时，
 * `ToolExecutionService` 先查这里 ⇒ 直接返回"用户拒绝"终止态（不执行、不重提卡），
 * 循环随后带着这条结果继续，让模型改道或向用户说明。
 *
 * 只记"这一次调用"（toolCallId 全局唯一），不写规则库、不放宽后续同名命令的审批要求。
 * 内存态：进程重启即失效（重启后该调用已不再是"待审批"，由会话状态机收尾）。
 */

const deniedBySession = new Map<string, Set<string>>();

/** 标记某次工具调用已被用户拒绝 */
export function markToolCallDenied(
  sessionId: string | undefined,
  toolCallId: string | undefined
): void {
  if (!sessionId || !toolCallId) return;
  let set = deniedBySession.get(sessionId);
  if (!set) {
    set = new Set<string>();
    deniedBySession.set(sessionId, set);
  }
  set.add(toolCallId);
}

/** 该次调用是否已被用户拒绝 */
export function isToolCallDenied(
  sessionId: string | undefined,
  toolCallId: string | undefined
): boolean {
  if (!sessionId || !toolCallId) return false;
  return deniedBySession.get(sessionId)?.has(toolCallId) === true;
}

/** 清空拒绝记录（测试隔离 / 会话销毁） */
export function clearDeniedToolCalls(sessionId?: string): void {
  if (sessionId === undefined) {
    deniedBySession.clear();
    return;
  }
  deniedBySession.delete(sessionId);
}
