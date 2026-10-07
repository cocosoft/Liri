// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * liveEvents — 输出护栏结果的前端下发通道（**PC-1**，2026-10-07）
 *
 * 传输复用既有全局 SSE（`broadcastEvent` → `/v1/events` `event: <type>`），前端
 * `useNotificationSSE` 按 `system:output_guard` 订阅 —— 与 `system:estop_changed` /
 * `system:resource_governor` 同族先例。
 *
 * **为什么必须下发**：`OUTPUT_GUARD` 命中后调用方**静默改写**正文（`updateMessageBlocks`
 * 替换 + `logger`），用户只见"内容被换过"却不知被**打码/阻断**（台账 §27.3-PC-1）。
 * 这同时是 `.trae/specs/guardrails-dual-side.md` §9.2④ 的 **P3 前置**
 * ——"否则不得静默改写用户可见内容"。
 *
 * 边界（CS03）
 * - 只发**动作**（`blocked` / `redacted`）+ 定位（`sessionId` / `messageId`）：**不发**
 *   `blockReason` 原文与护栏名（PC-5 文案去技术化；原文已由调用方 `logger` 留痕），
 *   避免前端耦合后端护栏标识符。
 * - 不下发任何"模型可见输入" ⇒ **不触发** `project_rules.md §1.6` 红线（无需新增会话事件）。
 */

/** SSE 事件名（前端 `useNotificationSSE` 订阅同一字面量） */
export const OUTPUT_GUARD_SSE_EVENT = 'system:output_guard';

/** 对用户可见的处置动作（对应 core `OutputGuardAction` 的 `block` / `redact`，面向 UI 命名） */
export type OutputGuardNoticeAction = 'blocked' | 'redacted';

/** 护栏结果通知 */
export interface OutputGuardNotice {
  sessionId: string;
  messageId: string;
  action: OutputGuardNoticeAction;
}

/** 构造 JSON 安全载荷（**无 `undefined`**） */
export function buildOutputGuardPayload(
  notice: OutputGuardNotice
): Record<string, unknown> {
  return {
    sessionId: notice.sessionId,
    messageId: notice.messageId,
    action: notice.action,
  };
}

/**
 * 由护栏结果推导通知（**纯函数**，可单测）；未命中 ⇒ `null`（不下发）
 *
 * 判据为**结构化布尔**（CS02，非文案匹配）：`blocked` 优先于 `redacted`
 * —— 阻断路径的 `text` 已含改写语义，二者不会同时成立（见 `finalOutputGuard`）。
 */
export function buildOutputGuardNotice(
  sessionId: string,
  messageId: string,
  result: { blocked?: boolean; redacted?: boolean }
): OutputGuardNotice | null {
  if (result.blocked) return { sessionId, messageId, action: 'blocked' };
  if (result.redacted) return { sessionId, messageId, action: 'redacted' };
  return null;
}

/** 广播护栏通知（**懒加载** `broadcastEvent` 避免循环依赖；失败不影响护栏判定） */
export function emitOutputGuardNotice(notice: OutputGuardNotice): void {
  void (async () => {
    try {
      const { broadcastEvent } = await import('@modules/infrastructure');
      broadcastEvent(OUTPUT_GUARD_SSE_EVENT, buildOutputGuardPayload(notice));
    } catch {
      // @ignore-catch — 通知下发失败不影响护栏判定（CS03）
    }
  })();
}

/** 便捷入口：由护栏结果直接下发（未命中 ⇒ 不下发） */
export function notifyOutputGuardResult(
  sessionId: string,
  messageId: string,
  result: { blocked?: boolean; redacted?: boolean }
): void {
  const notice = buildOutputGuardNotice(sessionId, messageId, result);
  if (notice) emitOutputGuardNotice(notice);
}
