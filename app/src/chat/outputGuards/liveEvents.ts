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
 * - 不下发任何"模型可见输入" ⇒ **不触发** `project_rules.md §1.6` 红线（SSE 侧无需会话事件）。
 *   **P4**（2026-10-07 起）另在 `appendOutputGuardAudit()` 中落**会话事件**
 *   （`validation/output_guard_applied`）—— 那是"正文被改写"的**持久留痕**，与 SSE 提示分属两条通道。
 */

import { feature } from '@modules/core';
import { getLogger } from '@modules/monitoring';
import type { LiriEvent } from '@modules/session/types/events.js';

import { buildOutputGuardAuditPayload } from '../finalOutputGuard.js';
import type { FinalOutputGuardResult } from '../finalOutputGuard.js';

const logger = getLogger('chat:output-guard');

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

/** 落一条会话事件的结果（与 `host.appendStreamEvent` 同形；此处只取需要的两个字段） */
export interface AppendAuditResult {
  ok: boolean;
  reason?: string;
}

/**
 * **P26-2 P4**：落「输出护栏改写审计」事件（`validation/output_guard_applied`）。
 *
 * 与 `notifyOutputGuardResult` 的分工（**故意分开**）：SSE 通知是 **best-effort**
 * （丢了只影响提示条），而审计留痕是**持久事实**（§1.6 可重建精神）⇒ 前者同步不可等，
 * 后者 `await` 且**失败必留痕**（CS03-002：不得静默吞掉）。
 *
 * 载荷构成见 `buildOutputGuardAuditPayload`：**默认仅元数据**（动作 / 护栏名 / 原文长度 /
 * 原文 SHA-256）；原文仅在 `OUTPUT_GUARD_KEEP_ORIGINAL=true` 时附上。
 *
 * @param append 由调用方注入的落盘口（本模块保持**零 host 依赖**）
 * @returns 未命中（无载荷）⇒ `false`；命中且落盘成功 ⇒ `true`
 */
export async function appendOutputGuardAudit(
  append: (
    event: LiriEvent<'validation/output_guard_applied'>
  ) => Promise<AppendAuditResult>,
  sessionId: string,
  messageId: string,
  result: FinalOutputGuardResult
): Promise<boolean> {
  const payload = buildOutputGuardAuditPayload(
    result,
    messageId,
    feature('OUTPUT_GUARD_KEEP_ORIGINAL')
  );
  if (!payload) return false;

  // 完整 `LiriEvent` 信封（与 `ReActToolLoop._emitValidationInjected` 同范式）：
  // `seq: 0` 由落盘口原子分配；`sessionId` 同时出现在信封与载荷定位。
  const event: LiriEvent<'validation/output_guard_applied'> = {
    type: 'validation/output_guard_applied',
    schemaVersion: 1,
    seq: 0,
    time: Date.now(),
    sessionId,
    data: payload,
  };
  const appended = await append(event);
  if (!appended.ok) {
    logger.warning('outputGuard:audit_append_failed', {
      sessionId,
      messageId,
      reason: appended.reason,
    });
    return false;
  }
  return true;
}
