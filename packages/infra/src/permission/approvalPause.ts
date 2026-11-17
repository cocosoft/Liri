// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 「暂停持久化放行」开关（R3 落地，F2 细化粒度 2026-11-17；治理方案 §3.4）
 *
 * 出事时一键收紧：开启后 ——
 * 1. **不再新增**审批生成的放行规则（三个审批写入点先查本开关）；
 * 2. **已存在的**审批生成规则不参与判定（判定读取口统一过滤）——
 *    规则仍在列表/健康视图里可见、可逐条撤销，不做破坏性删除。
 *
 * 粒度（F2）：
 * - `global`：实例级（本机全部会话）；
 * - `sessions`：按**会话 id** 暂停（其它会话不受影响；会话结束后条目自然不再命中，可手动移除）。
 *
 * 配置形状（`config.json#permission.pauseApprovalPersistence`，向后兼容旧布尔值）：
 * ```jsonc
 * false                                        // 未暂停（旧形状 / 空状态写回的就是它）
 * true                                         // 全局暂停（旧形状）
 * { "global": false, "sessions": ["sess_x"] }  // 仅暂停某些会话
 * ```
 *
 * 职责边界：本模块只回答"这次判定要不要忽略审批规则"，不负责匹配规则本身
 * （匹配仍走 `isRuleMatch`）；调用方必须把 **会话上下文** 传进来，缺省 ⇒ 只按 `global`。
 */
import { configManager } from '@openliri/infra/config';
import { getLogger } from '@openliri/infra/monitoring';

import {
  isApprovalOriginatedRule,
  type PermissionRule,
} from './types/PermissionRule';

const logger = getLogger('permission:approvalPause');

/** 配置键（`GET /v1/config/permission.pauseApprovalPersistence` 同源） */
export const APPROVAL_PAUSE_CONFIG_KEY = 'permission.pauseApprovalPersistence';

/** 暂停状态（`global` 与 `sessions` 是「或」关系：任一命中即暂停） */
export interface ApprovalPauseState {
  /** 实例级暂停（本机全部会话） */
  global: boolean;
  /** 按会话暂停（会话 id 列表） */
  sessions: string[];
}

/** 规范化任意配置值为状态（非法/缺失 ⇒ 未暂停；不抛） */
function normalizeState(raw: unknown): ApprovalPauseState {
  if (raw === true) return { global: true, sessions: [] };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { global: false, sessions: [] };
  }
  const obj = raw as Record<string, unknown>;
  const rawSessions = Array.isArray(obj['sessions']) ? obj['sessions'] : [];
  const sessions = [
    ...new Set(
      rawSessions
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    ),
  ];
  return { global: obj['global'] === true, sessions };
}

/** 读取当前暂停状态（旧布尔配置自动归一） */
export function readApprovalPauseState(): ApprovalPauseState {
  return normalizeState(
    configManager.getValue<unknown>(APPROVAL_PAUSE_CONFIG_KEY)
  );
}

/** 是否**全局**暂停（旧接口语义；会话级判定请用 `isApprovalPauseActiveFor`） */
export function isApprovalPauseEnabled(): boolean {
  return readApprovalPauseState().global;
}

/**
 * 本次判定是否应忽略审批生成的规则。
 *
 * - `global=true` ⇒ 是；
 * - 传入 `sessionId` 且命中 `sessions` ⇒ 是；
 * - 无 `sessionId`（后台/无人值守等拿不到会话的路径）⇒ **只按 `global`**（如实边界：
 *   会话级暂停不扩散到无上下文的路径，避免"一个会话暂停导致全局收紧"）。
 */
export function isApprovalPauseActiveFor(scope?: {
  sessionId?: string;
}): boolean {
  const state = readApprovalPauseState();
  if (state.global) return true;
  const sessionId = scope?.sessionId?.trim();
  if (!sessionId) return false;
  return state.sessions.includes(sessionId);
}

/**
 * 判定读取口的统一过滤（R3 + F2）。
 *
 * 只过滤**审批生成**的规则；用户手建规则不受影响。`scope` 缺省 ⇒ 只按全局暂停
 * （此时等价于旧行为）。
 */
export function filterPausedApprovalRules(
  rules: PermissionRule[],
  scope?: { sessionId?: string }
): PermissionRule[] {
  if (rules.length === 0) return rules;
  if (!isApprovalPauseActiveFor(scope)) return rules;
  return rules.filter((rule) => !isApprovalOriginatedRule(rule));
}

/**
 * 整体写入暂停状态并留审计日志（`sessions` 去重 + 去空白；无会话级条目时仍写纯布尔，保持配置可读）。
 *
 * 规则过滤是**实时读配置**，故无需额外失效缓存；HTTP 层负责广播 `config:changed`。
 */
export function setApprovalPauseState(
  next: ApprovalPauseState
): ApprovalPauseState {
  const normalized = normalizeState(next);
  // 无会话级条目 ⇒ 仍写**纯布尔**（旧形状，便于手改/回滚）；有会话级 ⇒ 写对象
  const value =
    normalized.sessions.length === 0
      ? normalized.global
      : { global: normalized.global, sessions: normalized.sessions };
  configManager.setValue(APPROVAL_PAUSE_CONFIG_KEY, value);
  logger.info('permission:approval_pause_changed', {
    global: normalized.global,
    sessionCount: normalized.sessions.length,
    configKey: APPROVAL_PAUSE_CONFIG_KEY,
  });
  return normalized;
}

/** 设置**全局**暂停（保留既有会话级条目；旧调用方语义不变） */
export function setApprovalPauseEnabled(enabled: boolean): boolean {
  setApprovalPauseState({
    global: enabled,
    sessions: readApprovalPauseState().sessions,
  });
  return enabled;
}
