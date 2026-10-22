/**
 * 会话洞察面板（2026-10-23，方案 B）
 *
 * 契约：
 * - `report` 存在 ⇒ 按块渲染（统计 / 摘要 / 关键事实 / 决策 / 待决问题 / 涉及文件 / 建议）；
 * - `report.stats.totalMessages === 0` ⇒ 如实提示"暂无消息"（不渲染空区块）；
 * - `report` 缺失 ⇒ 回退为后端纯文本 `output`（旧后端兼容）；
 * - `error` / `loading` 优先于内容。
 *
 * i18n：`setup.ts` 的 `t` 读**真实 zh 字典**（TR-15），断言走 `createTestT()`，
 * 字典缺键会直接抛错 ⇒ 顺带锁住文案键存在。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import SessionInsightsModal from "../SessionInsightsModal";
import type { SessionInsightsReport } from "../SessionInsightsModal";
import { createTestT } from "../../../tests/createTestT";

const t = createTestT();

const REPORT: SessionInsightsReport = {
  sessionId: "s-1",
  stats: {
    totalMessages: 3,
    byRole: { user: 2, assistant: 1, system: 0, tool: 0 },
  },
  summary: "讨论了方案 B 的落点",
  keyFacts: ["关键事实一"],
  decisions: ["采用方案 B"],
  pendingQuestions: ["是否继续？"],
  fileChanges: ["app/src/x.ts"],
  suggestions: [
    { type: "follow-up", message: "先收敛待决问题", priority: "high" },
  ],
  extractedAt: 1,
};

function renderModal(
  over: Partial<Parameters<typeof SessionInsightsModal>[0]> = {},
) {
  const onClose = vi.fn();
  render(
    <SessionInsightsModal
      open
      loading={false}
      error={null}
      report={REPORT}
      text=""
      onClose={onClose}
      {...over}
    />,
  );
  return { onClose };
}

/** 区块标题形如「决策（1）」⇒ 前缀匹配 */
const heading = (key: string): HTMLElement =>
  screen.getByText(
    (_, element) =>
      element?.tagName === "H4" &&
      (element.textContent ?? "").startsWith(t(key)),
  );

const queryHeading = (key: string): HTMLElement | null =>
  screen.queryByText(
    (_, element) =>
      element?.tagName === "H4" &&
      (element.textContent ?? "").startsWith(t(key)),
  );

describe("SessionInsightsModal", () => {
  it("open=false ⇒ 不渲染", () => {
    render(
      <SessionInsightsModal
        open={false}
        loading={false}
        error={null}
        report={REPORT}
        text=""
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("结构化报告 ⇒ 分块渲染（摘要 / 决策 / 待决问题 / 涉及文件 / 建议）", () => {
    renderModal();

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      screen.getByText(
        t("chat.insightsStats", {
          total: 3,
          user: 2,
          assistant: 1,
          tool: 0,
          system: 0,
        }),
      ),
    ).toBeTruthy();
    expect(heading("chat.insightsSummary")).toBeTruthy();
    expect(heading("chat.insightsDecisions")).toBeTruthy();
    expect(heading("chat.insightsPending")).toBeTruthy();
    expect(heading("chat.insightsFiles")).toBeTruthy();
    expect(heading("chat.insightsSuggestions")).toBeTruthy();
    // 条目正文与优先级前缀都要出来
    expect(screen.getByText("采用方案 B")).toBeTruthy();
    expect(screen.getByText("[HIGH] 先收敛待决问题")).toBeTruthy();
  });

  it("空会话 ⇒ 如实提示「暂无消息」，不渲染空区块", () => {
    renderModal({
      report: {
        ...REPORT,
        stats: {
          totalMessages: 0,
          byRole: { user: 0, assistant: 0, system: 0, tool: 0 },
        },
        summary: "",
        keyFacts: [],
        decisions: [],
        pendingQuestions: [],
        fileChanges: [],
        suggestions: [],
      },
    });

    expect(screen.getByText(t("chat.insightsNoMessages"))).toBeTruthy();
    expect(queryHeading("chat.insightsDecisions")).toBeNull();
  });

  it("无结构化载荷 ⇒ 回退为后端纯文本", () => {
    renderModal({ report: null, text: "会话洞察（会话 s-1）\n- 消息总数: 3" });

    expect(screen.getByText(/消息总数: 3/)).toBeTruthy();
    expect(queryHeading("chat.insightsDecisions")).toBeNull();
  });

  it("error 优先于内容；loading 优先于内容", () => {
    const { unmount } = render(
      <SessionInsightsModal
        open
        loading={false}
        error="读取失败"
        report={REPORT}
        text=""
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("读取失败");
    unmount();

    render(
      <SessionInsightsModal
        open
        loading
        error={null}
        report={null}
        text=""
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(t("chat.insightsLoading"))).toBeTruthy();
  });

  it("关闭按钮可关闭", () => {
    const { onClose } = renderModal();

    fireEvent.click(screen.getByLabelText(t("common.close")));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
