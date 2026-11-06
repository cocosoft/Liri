// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// P2-1（2026-11-06）回归锁：成果面板两源合并去重。
//
// 旧实现"artifacts 非空就不扫目录" ⇒ 混合产出（部分 write_project_file、部分 bash）
// 时未登记的那批文件从面板消失。现口径：目录扫描结果里已被正式成果覆盖的路径不重复展示。

import { describe, expect, it } from "vitest";

import {
  isDeliverableFile,
  selectUnregisteredDeliverables,
} from "../projectDeliverables";

const artifact = (title: string, content: string) => ({ title, content });
const file = (name: string) => ({ name, size: 1024, type: "html" });

describe("isDeliverableFile", () => {
  it("交付类扩展名（含嵌套目录）⇒ true", () => {
    expect(isDeliverableFile("index.html")).toBe(true);
    expect(isDeliverableFile("output/tetris/index.html")).toBe(true);
    expect(isDeliverableFile("output\\报告.docx")).toBe(true);
  });

  it("输入/过程目录、临时文件、非交付扩展 ⇒ false", () => {
    expect(isDeliverableFile("00_input/spec.md")).toBe(false);
    expect(isDeliverableFile("01_work/draft.md")).toBe(false);
    expect(isDeliverableFile("_tmp.html")).toBe(false);
    expect(isDeliverableFile("src/main.ts")).toBe(false);
  });
});

describe("selectUnregisteredDeliverables", () => {
  it("已是正式成果的路径不重复展示；未登记的交付文件保留（非交付扩展仍排除）", () => {
    const files = [
      file("output/report.docx"),
      file("output/tetris/index.html"),
      file("output/tetris/style.css"),
    ];
    const kept = selectUnregisteredDeliverables(
      [artifact("report.docx", "output/report.docx")],
      files,
    );
    // style.css 不在交付扩展名单里（与改造前的面板口径一致）
    expect(kept.map((f) => f.name)).toEqual(["output/tetris/index.html"]);
  });

  it("成果 content 是根目录文件名 ⇒ 按文件名去重（title/content 两种来源都认）", () => {
    const kept = selectUnregisteredDeliverables(
      [artifact("报告.docx", "报告.docx"), artifact("plan", "index.html")],
      [file("报告.docx")],
    );
    expect(kept).toEqual([]);
  });

  it("成果 content 是多行正文 ⇒ 按 title 的文件名去重（不把正文当路径）", () => {
    const kept = selectUnregisteredDeliverables(
      [
        artifact("summary.md", "# 这是一段手工成果正文\n没有路径"),
        artifact("notes", "# 另一段正文\n也没有扩展名"),
      ],
      [file("output/summary.md"), file("output/notes.md")],
    );
    // summary.md 的 title 命中 ⇒ 去重；notes 无扩展名 ⇒ 不误伤 output/notes.md
    expect(kept.map((f) => f.name)).toEqual(["output/notes.md"]);
  });

  it("路径分隔符不同（\\ vs /）视为同一文件", () => {
    const kept = selectUnregisteredDeliverables(
      [artifact("report.docx", "output\\report.docx")],
      [file("output/report.docx")],
    );
    expect(kept).toEqual([]);
  });

  it("非交付类文件即使未登记也不进面板", () => {
    const kept = selectUnregisteredDeliverables(
      [],
      [file("src/main.ts"), file("00_input/spec.md")],
    );
    expect(kept).toEqual([]);
  });

  it("artifacts 为空 ⇒ 等价于全量扫描交付类文件", () => {
    const kept = selectUnregisteredDeliverables(
      [],
      [file("a.html"), file("src/b.ts")],
    );
    expect(kept.map((f) => f.name)).toEqual(["a.html"]);
  });
});
