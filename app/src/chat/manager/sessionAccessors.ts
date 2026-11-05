// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 会话元数据 / 文本投影（B 批外移，2026-11-05）
 *
 * 从 `ChatManager` 迁出的 8 个**纯读取**助手（原 1595–1716，约 127 行）：
 * 前 4 个从会话 `metadata` 派生工作区 / 审批 / 权限模式，后 3 个从消息序列取文本。
 *
 * 为什么外移：它们只依赖「会话表 + 会话对象」，不持有任何宿主状态，却被 3 个消费方
 * （`facadeWiring` 的端口、`ToolExecutionService`、子代理升级判定）经宿主绑定绕行；
 * 收敛到纯函数后调用方直接传 `sessions`，宿主不再需要保留 8 个转发方法。
 *
 * 口径不变：`getSessionPermissionMode` 仍只认 9 个合法值（脏值 ⇒ `undefined` ⇒ 进程默认档）；
 * `isLastAssistantOutputFallback` 仍以结构化标记 `metadata.emptyOutputFallback` 为唯一依据（CS02）。
 */

import {
  PERMISSION_MODES,
  type PermissionMode,
} from '@openliri/infra/permission';
import type { ChatSession } from '@modules/session/types/session';

import { isEmptyOutputFallbackMessage } from '../terminationOutput';

/** 会话表（`Map` 或任意 `get(id)` 视图） */
export interface SessionLookup {
  get(id: string): ChatSession | undefined;
}

function metaOf(
  session: ChatSession | undefined
): Record<string, unknown> | undefined {
  return session?.metadata as Record<string, unknown> | undefined;
}

/**
 * 会话绑定的真实工作区 ID（项目模块会话 = projectId）。
 *
 * 供 `create_project` 工具使用，避免 AI 建的项目挂到 sessionId 名下（前端 projects 列表不可见）。
 */
export function getSessionWorkspaceId(
  sessions: SessionLookup,
  sessionId?: string
): string | undefined {
  if (!sessionId) return undefined;
  const workspaceId = metaOf(sessions.get(sessionId))?.workspaceId as
    | string
    | undefined;
  // 项目模块下 workspaceId === projectId（sessionSlice 约定），返回真实工作区 ID
  return workspaceId || undefined;
}

/**
 * 会话是否声明**工作区严格边界**（仅 AlwaysOn 隔离轮把 `metadata.workspaceStrict` 置 true）。
 * 其余会话未声明 ⇒ `false`（零行为变更）。
 */
export function isSessionWorkspaceStrict(
  sessions: SessionLookup,
  sessionId?: string
): boolean {
  if (!sessionId) return false;
  return metaOf(sessions.get(sessionId))?.workspaceStrict === true;
}

/**
 * 会话级审批模式（`metadata.approvalMode`）。
 *
 * 只认白名单值：`auto-local` ⇒ 自动执行；其余（含缺失 / 脏值）一律 `ask` —— 不因未知取值放宽。
 */
export function getSessionApprovalMode(
  sessions: SessionLookup,
  sessionId?: string
): 'ask' | 'auto-local' {
  if (!sessionId) return 'ask';
  return metaOf(sessions.get(sessionId))?.approvalMode === 'auto-local'
    ? 'auto-local'
    : 'ask';
}

/**
 * 会话级权限模式（`metadata.permission_mode`）。
 *
 * 只认 9 个合法值；缺失 / 脏值 ⇒ `undefined`（回退 `PermissionManager` 的进程默认档）。
 */
export function getSessionPermissionMode(
  sessions: SessionLookup,
  sessionId?: string
): PermissionMode | undefined {
  if (!sessionId) return undefined;
  const raw = metaOf(sessions.get(sessionId))?.permission_mode;
  if (typeof raw !== 'string') return undefined;
  const normalized = raw.trim().toLowerCase();
  return PERMISSION_MODES.find((mode) => mode.toLowerCase() === normalized);
}

/**
 * 最近 N 条 user 消息文本（换行拼接）—— 裸会话升级判定**共用**的取数口径。
 *
 * 任务轮内模型可能 `ask_user_question` 澄清，澄清答复会占住"最后一条 user"位置使任务原句
 * 被覆盖 ⇒ 聚合最近 3 条。
 */
export function recentUserText(session: ChatSession, n = 3): string {
  const userMessages = session.messages?.filter((m) => m.role === 'user') ?? [];
  return userMessages
    .slice(-n)
    .map((m) => {
      const c = (m as unknown as Record<string, unknown>)?.content;
      return typeof c === 'string' ? c : '';
    })
    .join('\n');
}

/** 最近一条 assistant 消息的文本（无则空串 —— 工具型收尾常为空） */
export function lastAssistantText(session: ChatSession): string {
  const messages = session.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as unknown as { role?: string; content?: unknown };
    if (m?.role === 'assistant' && typeof m.content === 'string') {
      return m.content;
    }
  }
  return '';
}

/**
 * 最近一条 assistant 消息是否为「空输出兜底」投影。
 *
 * 唯一依据是消息 `metadata.emptyOutputFallback`（`computeFinalMessage` 写入的结构化标记），
 * **禁止**比对兜底文案本身（CS02）。
 */
export function isLastAssistantOutputFallback(session: ChatSession): boolean {
  const messages = session.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if ((m as { role?: string })?.role === 'assistant') {
      return isEmptyOutputFallbackMessage(m);
    }
  }
  return false;
}
