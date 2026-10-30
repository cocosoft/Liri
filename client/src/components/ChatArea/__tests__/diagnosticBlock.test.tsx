/**
 * C4（2026-10-30）：诊断折叠块默认收起、点击展开显示原文。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// MarkdownRenderer 会拉起全局 i18n 实例（单测无需）⇒ 用最窄替身，只验证"详情是否渲染"
vi.mock("../MarkdownRenderer", () => ({
  default: ({ content }: { content: string }) => <div>{content}</div>,
}));

import DiagnosticBlock from "../DiagnosticBlock";

const DATA = {
  summary: "⚠️ 工具执行失败: Command failed: type …",
  detail: "⚠️ 工具执行失败: Command failed: type C:\\x\n\n详细 stderr 行",
};

describe("DiagnosticBlock", () => {
  it("默认收起：只显示摘要，不显示原文", () => {
    render(<DiagnosticBlock data={DATA} />);
    expect(screen.getByText(DATA.summary)).toBeTruthy();
    expect(screen.queryByText(/详细 stderr 行/)).toBeNull();
    expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("点击展开 ⇒ 显示原文（aria-expanded=true），再点收起", () => {
    render(<DiagnosticBlock data={DATA} />);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/详细 stderr 行/)).toBeTruthy();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText(/详细 stderr 行/)).toBeNull();
  });
});
