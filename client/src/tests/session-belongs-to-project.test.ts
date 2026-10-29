// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * F-22（2026-10-29）：`sessionBelongsToProject` 回归锁 —— 「会话是否属于该项目」的唯一判据。
 *
 * 背景（真机）：`proj_1793116653351_d0760e` 已有 1 条 311 消息、`metadata.projectId` 绑定到它的会话，
 * 但 `ProjectsPage.init()` 当时只用 `resolveSessionWorkspaceId(workspaceId)` 判定，
 * 该会话**没有** `workspaceId` ⇒ 被判成「无会话」⇒ 又新建了一条 0 消息的 `对话 1`。
 * 同一处口径还影响「删除项目时清理哪些会话」（会漏删只绑 `projectId` 的会话）。
 */
import { describe, expect, it } from "vitest";
import { sessionBelongsToProject } from "../stores/selectors";

const PID = "proj_1793116653351_d0760e";

describe("sessionBelongsToProject：projectId 优先、workspaceId 兜底", () => {
  it("只有 projectId（本机 10/28 条属于此类）⇒ 命中", () => {
    expect(sessionBelongsToProject({ projectId: PID }, PID)).toBe(true);
  });

  it("只有 workspaceId（本机 6/28 条属于此类）⇒ 命中", () => {
    expect(sessionBelongsToProject({ workspaceId: PID }, PID)).toBe(true);
  });

  it("两者都有且一致 ⇒ 命中；空串/空白视为缺失", () => {
    expect(
      sessionBelongsToProject({ projectId: PID, workspaceId: PID }, PID),
    ).toBe(true);
    expect(sessionBelongsToProject({ projectId: "  ", workspaceId: PID }, PID))
      .toBe(true);
  });

  it("projectId 与目标不同 ⇒ 不看 workspaceId 也判 false（projectId 是权威）", () => {
    expect(
      sessionBelongsToProject(
        { projectId: "proj_1793080542457_f2d9ce", workspaceId: PID },
        PID,
      ),
    ).toBe(false);
  });

  it("两个字段都缺失 / 属于别的项目 ⇒ false", () => {
    expect(sessionBelongsToProject({}, PID)).toBe(false);
    expect(sessionBelongsToProject({ projectId: "", workspaceId: "" }, PID))
      .toBe(false);
    expect(sessionBelongsToProject({ workspaceId: "chat" }, PID)).toBe(false);
    expect(sessionBelongsToProject({ workspaceId: "default" }, PID)).toBe(false);
  });
});
