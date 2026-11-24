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
 * 口径不变：`getSessionPermissionMode` 只认 5 个现行合法值（脏值 ⇒ `undefined` ⇒ 进程默认档）；
 * 2026-11-11 收缩前的旧值（`ask` / `alwaysAsk` / `acceptEdits` / `strict`）**读取时归一**
 * （并入 `plan` / `default`），旧会话不会因升级而改变行为；
 * B2（2026-11-09）唯一例外：未设置权限档的 **demand 会话**返回 `auto`（显式值仍优先）。
 * `isLastAssistantOutputFallback` 仍以结构化标记 `metadata.emptyOutputFallback` 为唯一依据（CS02）。
 */

import {
  normalizePermissionMode,
  type PermissionMode,
} from '@openliri/infra/permission';
// P2-B（2026-11-17）：本地会话缺省 auto-local 的灰度总闸
import { feature } from '@openliri/kernel';
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
 * P2-B（2026-11-17）：**本地桌面会话缺省走 `auto-local`**（工作区内写免问；只读本就放行），
 * 显式 `ask` / `auto-local` 仍优先。渠道 / 无人值守会话保持 `ask`（不因"本机默认"放宽）。
 * 后端开关 `FEATURE_SESSION_AUTO_LOCAL` 仍是总闸（关 ⇒ 全部 `ask`）。
 */
export function getSessionApprovalMode(
  sessions: SessionLookup,
  sessionId?: string
): 'ask' | 'auto-local' {
  if (!sessionId) return 'ask';
  const session = sessions.get(sessionId);
  const meta = metaOf(session);
  const declared = meta?.approvalMode;
  if (declared === 'auto-local' || declared === 'ask') return declared;
  const isLocalSession =
    (session as { type?: unknown } | undefined)?.type === 'local' ||
    meta?.sessionType === 'local';
  return isLocalSession && feature('SESSION_AUTO_LOCAL') ? 'auto-local' : 'ask';
}

/**
 * 会话级权限模式（`metadata.permission_mode`）。
 *
 * 只认 5 个现行合法值；收缩前的旧值按 `normalizePermissionMode` 归一；
 * 缺失 / 其余脏值 ⇒ `undefined`（回退 `PermissionManager` 的进程默认档）。
 */
export function getSessionPermissionMode(
  sessions: SessionLookup,
  sessionId?: string
): PermissionMode | undefined {
  if (!sessionId) return undefined;
  const meta = metaOf(sessions.get(sessionId));
  const raw = meta?.permission_mode;
  if (typeof raw !== 'string') {
    // B2（2026-11-09）：demand（许愿式）会话**缺省档为 auto**（可被显式 permission_mode
    // 覆盖）。只改"未设置"时的缺省值：越界写 / 删除 / Bash 闸仍按各自策略判定（D3）。
    return meta?.autonomy === 'demand' ? 'auto' : undefined;
  }
  return normalizePermissionMode(raw);
}

/**
 * P0（2026-11-17）：会话自主度（`metadata.autonomy`）。
 *
 * 仅 `demand` 会在权限层产生行为（非危险 ask ⇒ 自动放行，工作区外写仍人工）；
 * 其余（缺省 / 脏值）一律 `interactive` ⇒ 与改造前逐字一致。
 */
export function getSessionAutonomy(
  sessions: SessionLookup,
  sessionId?: string
): 'interactive' | 'demand' {
  if (!sessionId) return 'interactive';
  const meta = metaOf(sessions.get(sessionId));
  return meta?.autonomy === 'demand' ? 'demand' : 'interactive';
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

/**
 * 最近一条**非空** assistant 消息的文本（无则空串 —— 工具型收尾常为空）。
 *
 * P0（2026-11-24，真机 `session_mwq5ookl21aa28ea96`）：工具轮常把 assistant 消息以
 * `content=''` 落盘（仅承载 tool_calls）。原实现只要求 `typeof content === 'string'`
 * 就返回 ⇒ "最近一条"可能是空串 ⇒ 长任务信号升级时以**空描述**建项目 + 阶段链
 * （该任务烧了 2.32M tokens 产出一份无人认领的 PRD）。此处跳过空白文本，
 * 由调用方回退"最近用户文本"。
 */
export function lastAssistantText(session: ChatSession): string {
  const messages = session.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as unknown as { role?: string; content?: unknown };
    if (
      m?.role === 'assistant' &&
      typeof m.content === 'string' &&
      m.content.trim()
    ) {
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
