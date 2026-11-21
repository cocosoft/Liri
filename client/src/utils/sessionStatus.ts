/**
 * #23（2026-10-30）：会话列表呈现用的纯函数（状态徽标 / 空会话判定）。
 *
 * 背景（真机）：磁盘 32 个会话中 18 个 `paused`、11 个 `error`，但列表里**没有任何标记**
 * —— 原因是后端 `GET /v1/sessions` 只投影内存态、且 `mapSessionStatusToState` 缺
 * `error` 映射，状态在接口层就已丢失。后端补齐 `status` 后，前端集中在这里做
 * 「取值 → 呈现」的纯映射，避免徽标文案/色调散落在组件里各写一套。
 */
import type { SessionStatus } from "../types";

/** 徽标色调：`warning` = 可恢复的中断；`danger` = 本轮出错未完成 */
export type SessionStatusTone = "warning" | "danger";

export interface SessionStatusBadge {
  tone: SessionStatusTone;
  /** 徽标短文案（列表项内直接显示） */
  labelKey: string;
  /** 悬停/无障碍提示（说明发生了什么，不暴露内部错误细节） */
  hintKey: string;
}

/**
 * 需要徽标的状态映射表 —— 只登记「用户必须知道这轮没正常结束」的状态。
 * `active`/`running`/`completed` 等正常态不显示徽标（避免列表噪音）。
 */
const STATUS_BADGES: Partial<Record<SessionStatus, SessionStatusBadge>> = {
  paused: {
    tone: "warning",
    labelKey: "chat.sessionStatusPaused",
    hintKey: "chat.sessionStatusPausedHint",
  },
  error: {
    tone: "danger",
    labelKey: "chat.sessionStatusError",
    hintKey: "chat.sessionStatusErrorHint",
  },
  // P1-2（2026-11-06）：等待审批 ⇒ 列表可辨（此前该状态恒不出现，用户看不出"卡在等批"）
  requires_action: {
    tone: "warning",
    labelKey: "chat.sessionStatusRequiresAction",
    hintKey: "chat.sessionStatusRequiresActionHint",
  },
};

/**
 * 解析会话状态徽标。
 * @param status 后端 `SessionInfo.status`（可能缺省 —— 老版本后端）
 * @returns 徽标描述；正常态或未知取值返回 null（不渲染徽标）
 */
export function resolveSessionStatusBadge(
  status?: string | null,
): SessionStatusBadge | null {
  if (!status) return null;
  return STATUS_BADGES[status as SessionStatus] ?? null;
}

/**
 * 2026-11-21（真机治理 P1-2 产品决策）：「最近一次审批已过期（未执行）」徽标。
 *
 * 过期后会话状态已收敛为 `active`（卡不可回复），`status` 无法表达该事实
 * ⇒ 依据后端持久化的 `metadata.approvalExpiredAt`（用户重新发言即清除）。
 */
export function resolveApprovalExpiredBadge(): SessionStatusBadge {
  return {
    tone: "warning",
    labelKey: "chat.sessionStatusApprovalExpired",
    hintKey: "chat.sessionStatusApprovalExpiredHint",
  };
}

/**
 * 会话列表徽标**唯一入口**：状态徽标优先（`requires_action` = 还有可回复的卡），
 * 其次才看「上次已过期」标记 —— 两者同时成立时不得展示互相矛盾的文案。
 *
 * @param session 至少含 `status` 与 `approvalExpiredAt`（均可能缺省）
 */
export function resolveSessionBadge(session: {
  status?: string | null;
  approvalExpiredAt?: number;
}): SessionStatusBadge | null {
  const statusBadge = resolveSessionStatusBadge(session.status);
  if (statusBadge) return statusBadge;
  return typeof session.approvalExpiredAt === "number"
    ? resolveApprovalExpiredBadge()
    : null;
}

/**
 * 空会话判定：0 条会话消息。
 *
 * 后端 `messageCount` 已排除工具记录（`countConversationMessages`），故直接以它为判据；
 * 缺字段按 0 处理（与后端缺省一致）。
 */
export function isEmptySession(session: { messageCount?: number }): boolean {
  return (session.messageCount ?? 0) <= 0;
}
