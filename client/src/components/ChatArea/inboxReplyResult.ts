/**
 * Inbox 回复结果的「是否真的生效」判据（2026-11-04，P0-1 排查）
 *
 * 缺陷现场：用户在聊天里点了「批准」，界面提示成功，但后端没有任何 `replied_at`，
 * 工作区目录始终没进 `workspaceRoots`。原因是 `POST /v1/inbox/:id/reply` 对
 * 「卡已过期 / 此前已处理 / 并发冲突」也返回 **HTTP 200**，而组件只看 `res.ok`。
 *
 * 现约定（后端 `inbox-handlers.ts` 同源）：这三种结局带 `applied: false`；
 * 真正生效的回复返回 Inbox 项本身（`status: "replied"`）。旧后端没有 `applied` 字段时，
 * 回退按 `status` 判定，保证灰度期行为不倒退。
 */
const NOT_APPLIED_STATUSES = new Set([
  "expired",
  "already_processed",
  "concurrent_conflict",
]);

export interface InboxReplyBody {
  status?: string;
  applied?: boolean;
  message?: string;
}

/** 回复是否真的落地（`false` ⇒ 必须提示用户"未生效"，不得显示成功） */
export function isInboxReplyApplied(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const body = data as InboxReplyBody;
  if (body.applied === false) return false;
  if (typeof body.status === "string" && NOT_APPLIED_STATUSES.has(body.status))
    return false;
  return true;
}

/** 未生效时给用户看的原因（后端 `message` 优先，其余按状态给出固定文案） */
export function inboxReplyNotAppliedReason(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const body = data as InboxReplyBody;
  if (typeof body.message === "string" && body.message.trim())
    return body.message;
  if (body.status === "expired") return "该审批已超时失效，请让模型重新发起";
  if (body.status === "already_processed") return "该审批此前已处理";
  if (body.status === "concurrent_conflict") return "该审批正在被处理，请稍后刷新";
  return undefined;
}
