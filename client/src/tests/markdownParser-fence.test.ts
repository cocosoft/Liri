// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * markdownParser 代码围栏容错（2026-11-21）
 *
 * 背景：历史落盘块被压平时，闭合围栏会与末行正文粘连（`…淘汰这里``` `），
 * 原解析器只认"行首 ```"⇒ 代码块不闭合，后续所有段落被吞进 `<pre>`。
 * 本组锁定：正常围栏行为不变；粘连闭合按"行尾 ```"收口；未闭合仍保留原行为。
 */
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../utils/markdownParser";

const ref = () => ({ current: 0 });

describe("parseMarkdown：代码围栏容错", () => {
  it("正常围栏（独占一行）行为不变", () => {
    const blocks = parseMarkdown("```\ncode\n```\n\n结尾", ref());
    expect(blocks.map((b) => b.type)).toEqual(["code", "text"]);
    expect(blocks[0].content).toBe("code");
    expect(blocks[1].content).toBe("结尾");
  });

  it("粘连闭合（行尾 ```）⇒ 代码块收口，后续行按正文解析", () => {
    const blocks = parseMarkdown(
      "```\nhead → tail 这里```\n2. **时间戳**",
      ref(),
    );
    expect(blocks[0].type).toBe("code");
    expect(blocks[0].content).toBe("head → tail 这里");
    expect(blocks[1]?.type).toBe("list");
    expect(blocks[1]?.content).toContain("2. **时间戳**");
  });

  it("保守边界：围栏后仍有正文（非行尾）⇒ 不触发容错", () => {
    // 只认"行尾 ```"；行中围栏可能出现在合法代码内容里（如文档示例），不冒误伤风险
    const blocks = parseMarkdown("```\ncode```剩余正文", ref());
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe("code```剩余正文");
  });

  it("未闭合围栏 ⇒ 维持原行为（吃到末尾）", () => {
    const blocks = parseMarkdown("```\ncode\nmore", ref());
    expect(blocks).toHaveLength(1);
    expect(blocks[0].content).toBe("code\nmore");
  });
});
