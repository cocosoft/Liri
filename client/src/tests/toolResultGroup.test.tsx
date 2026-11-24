// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ToolResultGroup（2026-11-24）
 *
 * 存量会话（无事件日志）的连续孤儿工具结果在 `setMessages` 合并为一条消息，
 * 本组件负责把它折叠成树：默认一行组头，展开后逐条结果可再展开正文。
 */
import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ToolResultGroup from "../components/ChatArea/ToolResultGroup";
import i18n from "../i18n";

const results = [
  { id: "t1", toolCallId: "call_abcdefgh", content: "第一条结果" },
  {
    id: "t2",
    toolCallId: "call_ijklmnop",
    content: "第二行细节\n附加说明",
  },
];

describe("ToolResultGroup（2026-11-24）", () => {
  it("默认折叠为一行组头，展开后逐条结果可再展开正文", () => {
    render(<ToolResultGroup results={results} />);

    // 折叠态：只有组头，条目与正文都不渲染
    expect(
      screen.getByText(
        String(i18n.t("chat.toolReturnGroup", { count: results.length })),
      ),
    ).toBeTruthy();
    expect(screen.queryByText("#abcdefgh")).toBeNull();
    expect(screen.queryByText(/附加说明/)).toBeNull();

    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(screen.getByText("#abcdefgh")).toBeTruthy();
    const secondRow = screen.getByText("#ijklmnop").closest("button");
    expect(secondRow).toBeTruthy();
    // 展开组后仍只显示首行摘要
    expect(screen.queryByText(/附加说明/)).toBeNull();

    fireEvent.click(secondRow!);
    expect(secondRow!.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/附加说明/)).toBeTruthy();
  });

  it("单条结果：展开组头即见正文（不打第二层折叠）", () => {
    render(
      <ToolResultGroup
        results={[
          {
            id: "t1",
            toolCallId: "call_abc12345",
            content: "单条结果正文",
          },
        ]}
      />,
    );

    expect(
      screen.getByText(String(i18n.t("chat.toolReturnGroup", { count: 1 }))),
    ).toBeTruthy();
    // 单条时组头直接带调用 id
    expect(screen.getByText("#abc12345")).toBeTruthy();
    expect(screen.queryByText(/单条结果正文/)).toBeNull();

    fireEvent.click(screen.getAllByRole("button")[0]);
    expect(screen.getByText(/单条结果正文/)).toBeTruthy();
  });
});
