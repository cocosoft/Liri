/**
 * P2-3（2026-11-05）：工具显示名 / 摘要的**覆盖缺口**回归。
 *
 * 真机取证（`session_mw375o4312e5f31d38`，698 条消息）：`edit_file` 调用 **1** 次（执行成功）、
 * `tool_search` **10** 次（执行成功），而 `TOOL_NAME_MAP` 里都没有条目 ⇒ `getToolDisplayName`
 * 回退成原始英文名，UI 出现「edit_file」「tool_search」这种未翻译标签。
 * 另：`read_project_file` / `write_project_file` 是已注册的真实工具，同样缺标签。
 *
 * 锁定：
 *   · 别名与正名**显示同名**（`edit_file` ≡ `file_edit`），不再原样透出英文；
 *   · 项目文件两档有中文名，摘要带路径；
 *   · `tool_search` 的摘要是「检索工具：<query>」。
 */
import { describe, expect, it } from "vitest";

import {
  getToolDisplayName,
  getToolHumanSummary,
} from "../toolHumanSummary";

const call = (name: string, args: Record<string, unknown>) => ({
  id: "c1",
  name,
  arguments: args,
});

describe("P2-3 工具显示名覆盖", () => {
  it("别名与正名显示同名（不再透出英文 edit_file / write_file / read_file）", () => {
    expect(getToolDisplayName("edit_file")).toBe(
      getToolDisplayName("file_edit"),
    );
    expect(getToolDisplayName("write_file")).toBe(
      getToolDisplayName("file_write"),
    );
    expect(getToolDisplayName("read_file")).toBe(
      getToolDisplayName("file_read"),
    );
    expect(getToolDisplayName("edit_file")).not.toBe("edit_file");
  });

  it("项目文件与工具检索有独立标签（不是原始英文名）", () => {
    for (const name of [
      "read_project_file",
      "write_project_file",
      "tool_search",
    ]) {
      expect(getToolDisplayName(name)).not.toBe(name);
    }
    expect(getToolDisplayName("tool_search")).not.toBe(
      getToolDisplayName("grep"),
    );
  });
});

describe("P2-3 工具摘要覆盖", () => {
  it("edit_file 的摘要是「编辑」而不是「写入」（与 file_edit 一致）", () => {
    const args = { file_path: "/tmp/a.ts", old_string: "a", new_string: "b" };
    expect(getToolHumanSummary(call("edit_file", args))).toBe(
      getToolHumanSummary(call("file_edit", args)),
    );
    expect(getToolHumanSummary(call("edit_file", args))).toContain(
      "编辑",
    );
  });

  it("write_file 摘要带路径（与 file_write 一致，含字符数）", () => {
    const args = { file_path: "/tmp/a.md", content: "hello" };
    expect(getToolHumanSummary(call("write_file", args))).toBe(
      getToolHumanSummary(call("file_write", args)),
    );
    expect(getToolHumanSummary(call("write_file", args))).toContain(
      "/tmp/a.md",
    );
  });

  it("tool_search 摘要带检索词与「检索工具」动作", () => {
    const summary = getToolHumanSummary(
      call("tool_search", { query: "web fetch" }),
    );
    expect(summary).toContain("检索工具");
    expect(summary).toContain("web fetch");
  });

  it("read_project_file 摘要带路径", () => {
    expect(
      getToolHumanSummary(call("read_project_file", { path: "PRD.md" })),
    ).toContain("PRD.md");
  });
});
