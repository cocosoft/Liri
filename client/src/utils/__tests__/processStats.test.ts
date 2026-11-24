/**
 * processStats — 过程组语义统计（2026-11-24，前端任务面板治理 · 批次 1）。
 *
 * 口径：编辑/读取按去重路径计数；搜索/命令按调用次数计数；无路径时按调用 id 去重回退。
 */
import { describe, expect, it } from "vitest";
import { hasProcessStats, summarizeProcessTools } from "../processStats";

describe("summarizeProcessTools", () => {
  it("同一文件多次读取只计 1 个；不同文件分别计数", () => {
    const stats = summarizeProcessTools([
      { id: "c1", name: "file_read", arguments: { file_path: "/a.ts" } },
      { id: "c2", name: "file_read", arguments: { file_path: "/a.ts" } },
      { id: "c3", name: "read_project_file", arguments: { path: "/b.ts" } },
    ]);
    expect(stats.readFiles).toBe(2);
    expect(stats.editedFiles).toBe(0);
  });

  it("编辑类按去重路径计数（file_write / file_edit）", () => {
    const stats = summarizeProcessTools([
      { id: "c1", name: "file_edit", arguments: { file_path: "/a.ts" } },
      { id: "c2", name: "file_write", arguments: { file_path: "/a.ts" } },
      { id: "c3", name: "file_write", arguments: { file_path: "/b.ts" } },
    ]);
    expect(stats.editedFiles).toBe(2);
  });

  it("搜索 / 命令按调用次数计数（不按文件去重）", () => {
    const stats = summarizeProcessTools([
      { id: "c1", name: "grep", arguments: { pattern: "x" } },
      { id: "c2", name: "grep", arguments: { pattern: "x" } },
      { id: "c3", name: "glob", arguments: { pattern: "*.ts" } },
      { id: "c4", name: "bash", arguments: { command: "ls" } },
      { id: "c5", name: "bash", arguments: { command: "ls" } },
    ]);
    expect(stats.searches).toBe(3);
    expect(stats.commands).toBe(2);
  });

  it("无路径参数时按调用 id 回退（不虚增、也不丢调用）", () => {
    const stats = summarizeProcessTools([
      { id: "c1", name: "file_read", arguments: {} },
      { id: "c2", name: "file_read", arguments: {} },
    ]);
    expect(stats.readFiles).toBe(2);
  });

  it("其它工具落入 other；空输入全零", () => {
    expect(
      summarizeProcessTools([{ id: "c1", name: "todo_write" }]).other,
    ).toBe(1);
    const empty = summarizeProcessTools([]);
    expect(empty).toEqual({
      editedFiles: 0,
      readFiles: 0,
      searches: 0,
      commands: 0,
      other: 0,
    });
    expect(hasProcessStats(empty)).toBe(false);
  });

  it("undefined 项被跳过（不抛错）", () => {
    const stats = summarizeProcessTools([
      undefined,
      { id: "c1", name: "grep" },
    ]);
    expect(stats.searches).toBe(1);
  });
});
