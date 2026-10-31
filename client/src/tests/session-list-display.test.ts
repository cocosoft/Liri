// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * #23（2026-10-30）：会话列表**显示口径**回归锁。
 *
 * 真机现象：对话页 31 条 vs 磁盘 32 个会话；18 个 `paused` / 11 个 `error` 会话在列表上
 * 与正常会话外观完全相同。三个纯函数分别锁住：
 * - `sessionMatchesModuleScope`：本模块列表该显示哪些会话（跨模块会话按设计不显示，
 *   这正是"条数与磁盘不一致"的**已知口径**，而不是丢数据）；
 * - `isEmptySession`：空会话（0 条消息）如何判定（默认折叠 + 一键清理共用）；
 * - `resolveSessionStatusBadge`：哪些状态必须给徽标（正常态不出徽标，避免噪音）。
 */

import { describe, expect, it } from "vitest";
import { sessionMatchesModuleScope } from "../stores/selectors";
import {
  isEmptySession,
  resolveSessionStatusBadge,
} from "../utils/sessionStatus";

describe("sessionMatchesModuleScope：列表作用域口径", () => {
  it("Hub 记录的 moduleType 优先（与 workspaceId 冲突时以 Hub 为准）", () => {
    const session = { workspaceId: "chat" };
    expect(sessionMatchesModuleScope(session, "media", "media")).toBe(true);
    expect(sessionMatchesModuleScope(session, "media", "chat")).toBe(false);
  });

  it("缺 Hub 记录时按 workspaceId 反推；proj_* 归 project（2026-10-31 §七裁定 2）", () => {
    expect(
      sessionMatchesModuleScope({ workspaceId: "media" }, undefined, "media"),
    ).toBe(true);
    // 裁定变更：`proj_<毫秒>_<随机>` 只有"项目会话"一种含义 ⇒ 反推为 project，
    // 不再落入 chat（原断言"proj_* 无法反推 ⇒ chat"已按裁定作废）。
    expect(
      sessionMatchesModuleScope(
        { workspaceId: "proj_1792831085133_bfc455" },
        undefined,
        "chat",
      ),
    ).toBe(false);
    expect(
      sessionMatchesModuleScope(
        { workspaceId: "proj_1792831085133_bfc455" },
        undefined,
        "project",
      ),
    ).toBe(true);
    expect(
      sessionMatchesModuleScope({ workspaceId: "" }, undefined, "chat"),
    ).toBe(true);
  });

  it("项目作用域：projectId 优先、workspaceId 兜底（与项目页卡片同判据）", () => {
    const pid = "proj_1793116653351_d0760e";
    expect(
      sessionMatchesModuleScope({ projectId: pid }, undefined, "project", pid),
    ).toBe(true);
    expect(
      sessionMatchesModuleScope(
        { workspaceId: pid, projectId: "proj_other" },
        undefined,
        "project",
        pid,
      ),
    ).toBe(false);
    expect(
      sessionMatchesModuleScope(
        { workspaceId: "proj_other" },
        undefined,
        "project",
        pid,
      ),
    ).toBe(false);
  });

  it("项目作用域缺 scopeProjectId 时退化为普通模块比较（不与任何项目 id 比较）", () => {
    expect(
      sessionMatchesModuleScope(
        { workspaceId: "proj_1792831085133_bfc455" },
        "project",
        "project",
      ),
    ).toBe(true);
    expect(
      sessionMatchesModuleScope({ workspaceId: "proj_x" }, "chat", "project"),
    ).toBe(false);
  });
});

describe("isEmptySession：空会话判定", () => {
  it("0 条消息 ⇒ 空；缺字段按 0 处理", () => {
    expect(isEmptySession({ messageCount: 0 })).toBe(true);
    expect(isEmptySession({})).toBe(true);
  });

  it("有消息 ⇒ 非空", () => {
    expect(isEmptySession({ messageCount: 2 })).toBe(false);
  });
});

describe("resolveSessionStatusBadge：状态徽标", () => {
  it("paused ⇒ 警示色；error ⇒ 危险色", () => {
    expect(resolveSessionStatusBadge("paused")?.tone).toBe("warning");
    expect(resolveSessionStatusBadge("error")?.tone).toBe("danger");
  });

  it("正常态 / 缺省 / 未知取值 ⇒ 不出徽标", () => {
    expect(resolveSessionStatusBadge("active")).toBeNull();
    expect(resolveSessionStatusBadge(undefined)).toBeNull();
    expect(resolveSessionStatusBadge("")).toBeNull();
    expect(resolveSessionStatusBadge("some-unknown-state")).toBeNull();
  });
});
