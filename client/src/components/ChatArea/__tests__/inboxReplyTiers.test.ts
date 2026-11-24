// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 批次 5 / C1（2026-11-24）：审批档位文案/分类的**单一事实源**。
 *
 * 缺口：就地审批（`InlineApprovalActions`）与审批卡（`InboxBlock`）各一份档位表，
 * 后者还会按前端白名单**丢弃**清单外档位 ⇒ 后端新增一档时两入口按钮不一致。
 */
import { describe, expect, it } from "vitest";
import {
  INBOX_REPLY_DANGER,
  INBOX_REPLY_LABEL_KEYS,
  isInboxReplyApproveLike,
} from "../inboxReplyTiers";

describe("inboxReplyTiers（审批档位唯一事实源）", () => {
  it("已登记档位都有 i18n 文案键", () => {
    for (const [reply, key] of Object.entries(INBOX_REPLY_LABEL_KEYS)) {
      expect(reply.length).toBeGreaterThan(0);
      expect(key.startsWith("chat.")).toBe(true);
    }
  });

  it("拒绝类档位走危险样式；放行类判定覆盖 approve / session / task / allowlist", () => {
    expect(INBOX_REPLY_DANGER.has("deny")).toBe(true);
    expect(INBOX_REPLY_DANGER.has("reject")).toBe(true);
    expect(INBOX_REPLY_DANGER.has("approve")).toBe(false);

    expect(isInboxReplyApproveLike("approve")).toBe(true);
    expect(isInboxReplyApproveLike("approve_session")).toBe(true);
    expect(isInboxReplyApproveLike("approve_task")).toBe(true);
    expect(isInboxReplyApproveLike("allowlist_call")).toBe(true);
    expect(isInboxReplyApproveLike("allowlist_workspace_command")).toBe(true);
    // 新增档位：只要落在 allowlist_ 前缀即视为放行类（不再逐档硬编码漏判）
    expect(isInboxReplyApproveLike("allowlist_future_tier")).toBe(true);
    expect(isInboxReplyApproveLike("deny")).toBe(false);
    expect(isInboxReplyApproveLike("reject")).toBe(false);
  });

  it("未登记档位没有文案键（调用方按约定回退后端值，不静默丢弃）", () => {
    expect(INBOX_REPLY_LABEL_KEYS["brand_new_tier"]).toBeUndefined();
  });
});
