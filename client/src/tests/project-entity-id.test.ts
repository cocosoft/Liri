// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P2（2026-10-29）：`isProjectEntityId` 回归锁。
 *
 * 背景：会话的 `workspaceId` 可能是项目 id（`proj_*`）。项目与工作空间是两套实体，
 * 拿项目 id 去请求 `/v1/workspaces/:id` 必然 404（真机 console：`Workspace not found`）。
 * 该谓词用于在「会话 → 工作空间」联动前跳过项目 id。
 */
import { describe, expect, it } from "vitest";
import { isProjectEntityId } from "../stores/selectors";

describe("isProjectEntityId", () => {
  it("后端项目 id（proj_<毫秒>_<随机>）⇒ true", () => {
    expect(isProjectEntityId("proj_1792831085133_bfc455")).toBe(true);
    expect(isProjectEntityId("  proj_1792674097920_d3545d  ")).toBe(true);
  });

  it("工作空间 / 系统模块 id ⇒ false", () => {
    expect(isProjectEntityId("default")).toBe(false);
    expect(isProjectEntityId("chat")).toBe(false);
    expect(isProjectEntityId("knowledge")).toBe(false);
    expect(isProjectEntityId("proj_")).toBe(false);
    expect(isProjectEntityId("proj_abc")).toBe(false);
  });

  it("空值 ⇒ false", () => {
    expect(isProjectEntityId("")).toBe(false);
    expect(isProjectEntityId(null)).toBe(false);
    expect(isProjectEntityId(undefined)).toBe(false);
  });
});
