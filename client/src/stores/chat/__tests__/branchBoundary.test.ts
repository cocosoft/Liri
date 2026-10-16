/**
 * 「编辑并另存为分支」零历史判定 —— 真机缺陷回归（2026-10-16）。
 *
 * 缺陷：原实现 fork 全量 + 事后 `editTruncate`；该截断在新会话恒被后端 404
 *（`Target message not found`）⇒ 分支重载后旧消息回显。
 * 真机复验证明：**只修"编辑首条 ⇒ 零历史"这一类是有效且可证的**；非首条所需的
 * "编辑点之前的事件边界"**客户端拿不到可信值**（字段常 null + 分页合成序号非事件 seq +
 * tail 戳可能落在未闭合 turn 内 ⇒ 后端 400），必须由后端按源会话 messageId 解析。
 * 本用例即钉住这两个分支的边界口径。
 */
import { describe, expect, it } from "vitest";
import { resolveBranchBoundary } from "../branchBoundary";

interface M {
  id: string;
}

const messages: M[] = [{ id: "u1" }, { id: "a1" }, { id: "u2" }, { id: "a2" }];

describe("resolveBranchBoundary（编辑并另存为分支的零历史判定）", () => {
  it("编辑首条 ⇒ empty（零历史：建空会话，不 fork 全量）", () => {
    expect(resolveBranchBoundary(messages, messages[0]!)).toEqual({
      kind: "empty",
    });
  });

  it("编辑非首条 ⇒ fallback（需后端解析事件边界，本轮不做客户端猜测）", () => {
    expect(resolveBranchBoundary(messages, messages[2]!)).toEqual({
      kind: "fallback",
    });
  });

  it("编辑点不在已加载列表中 ⇒ fallback", () => {
    expect(resolveBranchBoundary(messages, { id: "not-loaded" })).toEqual({
      kind: "fallback",
    });
  });

  it("editTarget 为空 ⇒ fallback", () => {
    expect(resolveBranchBoundary(messages, null)).toEqual({ kind: "fallback" });
    expect(resolveBranchBoundary(messages, undefined)).toEqual({
      kind: "fallback",
    });
  });
});
