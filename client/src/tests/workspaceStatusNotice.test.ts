/**
 * P0-1（2026-11-05）：会话工作区失效提示的**档位选择**（纯函数）。
 *
 * 后端 `GET /v1/sessions/:id` 的 `workspaceStatus` 由 `computeWorkspaceStatus` 派生：
 * `unbound` / `ok` / `partial` / `invalid`。本用例锁：
 *   · `unbound` / `ok` / 缺省 ⇒ 不提示（不打扰）；
 *   · `invalid` ⇒ 用"全部失效"文案，路径取 `missingRoots`（缺失时回落 `roots`）；
 *   · `partial` ⇒ 用"部分失效"文案。
 */
import { describe, expect, it } from "vitest";

import {
  getWorkspaceStatusNotice,
  shouldOfferWorkspaceRelocate,
} from "../utils/workspaceStatusNotice";
import type { WorkspaceStatus } from "../types/session";

const status = (partial: Partial<WorkspaceStatus>): WorkspaceStatus => ({
  state: "ok",
  roots: [],
  missingRoots: [],
  ...partial,
});

describe("P0-1 工作区状态提示", () => {
  it("ok / unbound / 缺省 ⇒ 不提示", () => {
    expect(getWorkspaceStatusNotice(undefined)).toBeNull();
    expect(getWorkspaceStatusNotice(status({ state: "ok" }))).toBeNull();
    expect(getWorkspaceStatusNotice(status({ state: "unbound" }))).toBeNull();
  });

  it("invalid ⇒ 全部失效文案 + missingRoots 路径", () => {
    const notice = getWorkspaceStatusNotice(
      status({
        state: "invalid",
        roots: ["E:\\dead\\worktree"],
        missingRoots: ["E:\\dead\\worktree"],
      }),
    );
    expect(notice).not.toBeNull();
    expect(notice!.titleKey).toBe("chat.workspaceInvalidTitle");
    expect(notice!.descKey).toBe("chat.workspaceInvalidDesc");
    expect(notice!.paths).toEqual(["E:\\dead\\worktree"]);
  });

  it("invalid 但 missingRoots 缺失 ⇒ 回落 roots（提示里必须有路径）", () => {
    const notice = getWorkspaceStatusNotice(
      status({ state: "invalid", roots: ["/gone"], missingRoots: [] }),
    );
    expect(notice!.paths).toEqual(["/gone"]);
  });

  it("partial ⇒ 部分失效文案 + 只列失效根", () => {
    const notice = getWorkspaceStatusNotice(
      status({
        state: "partial",
        roots: ["/ok", "/gone"],
        missingRoots: ["/gone"],
      }),
    );
    expect(notice!.titleKey).toBe("chat.workspacePartialTitle");
    expect(notice!.descKey).toBe("chat.workspacePartialDesc");
    expect(notice!.paths).toEqual(["/gone"]);
  });

  it("只有 invalid 才给「重新定位」入口（partial 时主根仍可用，替换会误伤）", () => {
    expect(shouldOfferWorkspaceRelocate(undefined)).toBe(false);
    expect(shouldOfferWorkspaceRelocate(status({ state: "unbound" }))).toBe(
      false,
    );
    expect(shouldOfferWorkspaceRelocate(status({ state: "ok" }))).toBe(false);
    expect(shouldOfferWorkspaceRelocate(status({ state: "partial" }))).toBe(
      false,
    );
    expect(shouldOfferWorkspaceRelocate(status({ state: "invalid" }))).toBe(
      true,
    );
  });
});
