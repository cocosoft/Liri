/**
 * O3-3（2026-09-24「会话暴露问题分析与优化方案」§五）：导出思考截断标注必须**无歧义**。
 *
 * 「修复前必失败」：原标注只有"（思考过长，已截断，共 N 字）"，读者无法判断导出里保留了多少，
 * 导出记录无法被独立审计（需猜测缺口）。
 */

import { describe, it, expect } from "vitest";
import { getMessageSearchText } from "../utils/messageText";

describe("O3-3 导出思考截断标注", () => {
  it("超长思考 ⇒ 同时给出保留规模与原文规模", () => {
    const long = "思考内容".repeat(100); // 400 字 > 300 上限
    const msg = {
      blocks: [{ type: "thinking", content: long }],
    } as never;

    const text = getMessageSearchText(msg, { forExport: true });

    expect(text).toContain("仅导出前 300 字");
    expect(text).toContain(`原文共 ${long.length} 字`);
    expect(text).toContain("完整思考见会话内");
  });

  it("短思考 ⇒ 不出现截断标注", () => {
    const msg = {
      blocks: [{ type: "thinking", content: "简短思考" }],
    } as never;

    const text = getMessageSearchText(msg, { forExport: true });

    expect(text).toContain("简短思考");
    expect(text).not.toContain("已截断");
  });
});
