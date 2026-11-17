/**
 * 任务卡「等待审批」徽标的**残留**回归锁（2026-11-17 用户实测）。
 *
 * 现场：PDCA 已以失败收尾（会话里已有「编排任务执行失败」回执），任务卡却仍写
 * 「⏸ 等待审批（需要你的反馈）」。根因是该徽标的旧判据为
 * `pendingApproval || status === "paused"` —— `status` 是**暂停那一刻的快照**，
 * 任务后续以失败/中止收尾时不会回写 ⇒ 永久残留。
 *
 * 现口径（只认结构化事实）：徽标只由 `pendingApproval` 触发（它已按 `inboxId` 与审批卡
 * 对账，见 `hasPendingApproval`）；没有待审批的 paused 卡按「已结束」结算呈现。
 *
 * 为什么用源码扫描：`TaskCard` 依赖 3 个 store + i18n 上下文，渲染成本高；
 * 本仓已有同类手法（`dailyLimitNoticeWiring.test.ts`）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../TaskCard.tsx"), "utf-8");

describe("TaskCard：等待审批徽标只认真实待审批（2026-11-17）", () => {
  it('徽标判据不得再包含 `|| status === "paused"` 这一残留来源', () => {
    expect(src).not.toContain('pendingApproval || status === "paused"');
  });

  it("徽标只由 pendingApproval 触发", () => {
    expect(src).toContain("{pendingApproval ? (");
  });

  it("无待审批的 paused 卡按「已结束」结算呈现（不再谎报在等）", () => {
    expect(src).toContain('{(status === "done" || status === "paused")');
  });
});
