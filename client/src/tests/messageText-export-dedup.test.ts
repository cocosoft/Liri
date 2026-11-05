/**
 * P2-2（2026-11-05）：会话导出**同一段落出现两次**（存储里只有 1 条）。
 *
 * 真机取证（`session_mw375o4312e5f31d38`）：146 条含 text 块的消息 / 191 个块中，
 * 176 个块原文即被 `content` 子串命中、9 个仅空白差异、**6 个块（5 条消息）两边都不互为子串**
 * （同一段落但中段有出入），且这 6 个块都短于 `content`。旧判据用"原文字符串包含"做去重 ⇒
 * 这些块与 `content` 被同时导出，用户看到整段重复（导出实证三处 export=2 / store=1）。
 *
 * 锁定：`content` 非空（去空白）即权威正文，text 块不再重复导出；content 为空时仍导出块。
 */
import { describe, expect, it } from "vitest";

import { getMessageSearchText } from "../utils/messageText";

const msg = (content: string, blockText: string) =>
  ({
    role: "assistant",
    content,
    blocks: [{ type: "text", content: blockText }],
  }) as never;

const count = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

describe("P2-2 导出不重复 text 块", () => {
  it("content 比块多几个前导换行（真机形态）⇒ 只出现一次", () => {
    const body = "能。刚做了实测，结论分三层：直连 x.com 返回 200。";
    const text = getMessageSearchText(msg(`\n\n\n${body}`, body), {
      forExport: true,
    });
    expect(count(text, "能。刚做了实测")).toBe(1);
  });

  it("content 与块**中段有出入**（真机形态，互为子串都不成立）⇒ 只出现一次", () => {
    const block = "先落地两件事：查明终止原因。然后接着干，改成 cwd 参数。";
    const content =
      "先落地两件事：查明终止原因。**核对磁盘真实状态**，然后接着干，改成 cwd 参数。";
    const text = getMessageSearchText(msg(content, block), { forExport: true });
    expect(count(text, "先落地两件事")).toBe(1);
    // 以 content（最终正文）为准，不把陈旧块再追加一遍
    expect(text).toContain("核对磁盘真实状态");
  });

  it("content 为空 ⇒ 仍导出块（历史消息正文只在块里）", () => {
    const block = "只有块里才有这段正文。";
    const text = getMessageSearchText(msg("", block), { forExport: true });
    expect(text).toContain(block);
  });

  it("content 只有空白 ⇒ 仍导出块", () => {
    const block = "空白 content 不算权威正文。";
    const text = getMessageSearchText(msg("  \n\n ", block), {
      forExport: true,
    });
    expect(text).toContain(block);
  });

  it("搜索版（非导出）同样不重复计入", () => {
    const body = "搜索索引里也不该出现两遍。";
    const text = getMessageSearchText(msg(`\n\n${body}`, body));
    expect(count(text, "搜索索引里也不该出现两遍")).toBe(1);
  });
});
