/**
 * 审批档位文案与分类 —— **单一事实源**（批次 5 / C1，2026-11-24）。
 *
 * 缺口：`InlineApprovalActions`（工具卡就地审批）与 `InboxBlock`（会话内审批卡）
 * 各维护一份档位清单；就地审批还会**丢弃**清单外的档位 ⇒ 后端新增一档时，
 * 同一审批在两个入口的按钮不一致（就地入口静默少一个）。
 *
 * 口径：后端仍是档位**唯一来源**（`inbox.options` / `actions`）；本模块只做
 * 「reply 值 → 文案键 / 危险样式」的展示映射，未登记的档位**如实回退后端 label 或原值**
 * （CS06：不编造、不静默丢弃）。
 */

/** 档位按钮文案 i18n 键（未登记的 reply 回退后端 label，CS06） */
export const INBOX_REPLY_LABEL_KEYS: Record<string, string> = {
  approve: "chat.inboxReplyApprove",
  approve_session: "chat.inboxReplyApproveSession",
  // P2（2026-11-04，§3.3）：本任务都允许（仅长程任务进行中出现）
  approve_task: "chat.inboxReplyApproveTask",
  allowlist_call: "chat.inboxReplyAllowAlways",
  allowlist_tool: "chat.inboxReplyAllowTool",
  // 2026-11-24：本会话内「该工具都允许」（不落持久化规则，会话结束失效）
  allowlist_tool_session: "chat.inboxReplyAllowToolSession",
  // 2026-11-26（用户裁定）：本会话内**整个工具**全部命令都允许（含危险命令，高风险）
  allowlist_tool_session_all: "chat.inboxReplyAllowToolSessionAll",
  allowlist_command: "chat.inboxReplyAllowCommand",
  allowlist_workspace_command: "chat.inboxReplyAllowWorkspaceCommand",
  reject: "chat.inboxReplyReject",
  deny: "chat.inboxReplyReject",
};

/** 拒绝类档位（红色样式） */
export const INBOX_REPLY_DANGER: ReadonlySet<string> = new Set([
  "deny",
  "reject",
]);

/** 是否放行类档位（批准 / 白名单 — 用于"已处理"提示与续跑判定） */
export function isInboxReplyApproveLike(reply: string): boolean {
  return (
    reply === "approve" ||
    reply.startsWith("allowlist_") ||
    reply === "approve_session" ||
    reply === "approve_task"
  );
}
