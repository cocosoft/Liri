/**
 * C4（2026-10-30）：内部诊断文本识别单测。
 *
 * 锁定：只看**开头**前缀、低于门槛不折叠（避免误伤正文里正常提到"工具执行失败"）、
 * 摘要取首行并截断、详情保留原文。
 */
import { describe, expect, it } from "vitest";

import {
  DIAGNOSTIC_MIN_CHARS,
  DIAGNOSTIC_SUMMARY_CHARS,
  splitDiagnosticText,
} from "../diagnosticText";

const LONG = "x".repeat(DIAGNOSTIC_MIN_CHARS);

describe("splitDiagnosticText：诊断识别", () => {
  it("`[系统提示]` 开头 ⇒ 命中，摘要取首行", () => {
    const text = `[系统提示] 上一轮工具调用返回了错误或空结果。不要直接结束对话…${LONG}`;
    const r = splitDiagnosticText(text);
    expect(r).not.toBeNull();
    expect(r!.summary.startsWith("[系统提示]")).toBe(true);
    expect(r!.detail).toBe(text.trim());
  });

  it("`⚠️ 工具执行失败` / `安全检查失败` / `Command failed:` ⇒ 命中", () => {
    for (const prefix of [
      "⚠️ 工具执行失败",
      "安全检查失败",
      "Command failed:",
    ]) {
      const text = `${prefix} 具体原因 ${LONG}`;
      expect(splitDiagnosticText(text)).not.toBeNull();
    }
  });

  it("允许前导空白与 Markdown 引用符", () => {
    const text = `  > [系统提示] ${LONG}`;
    expect(splitDiagnosticText(text)).not.toBeNull();
  });

  it("短文本 / 前缀不在开头 / 普通正文 ⇒ 不折叠", () => {
    expect(splitDiagnosticText("工具执行失败")).toBeNull(); // 低于门槛
    expect(
      splitDiagnosticText(`这一段先说了别的，然后提到工具执行失败：${LONG}`),
    ).toBeNull();
    expect(splitDiagnosticText("正常的分析结论，没有问题。")).toBeNull();
    expect(splitDiagnosticText(undefined)).toBeNull();
  });

  it("首行超长 ⇒ 摘要截断补省略号（详情仍是全文）", () => {
    const longFirstLine = `[系统提示] ${"字".repeat(DIAGNOSTIC_SUMMARY_CHARS + 20)}`;
    const r = splitDiagnosticText(`${longFirstLine}\n\n第二行`);
    expect(r!.summary).toHaveLength(DIAGNOSTIC_SUMMARY_CHARS + 1);
    expect(r!.summary.endsWith("…")).toBe(true);
    expect(r!.detail).toContain("第二行");
  });
});
