/**
 * 2026-11-24（用户裁定「简化前端显示内容」）：`ProgressCard` 下线后，
 * `progress` 块必须渲染为**空**，且不得回落到 `default` 分支渲染 `content`
 * （否则等于把面板换成一行裸文本）。本文件锁住该口径。
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/stores/chat", () => ({
  useChatStore: (
    selector: (s: { readFileToPreview: () => void }) => unknown,
  ) => selector({ readFileToPreview: () => {} }),
}));

import BlockRenderer from "../BlockRenderer";

describe("BlockRenderer — progress 块（ProgressCard 已下线）", () => {
  it("渲染为空，不显示描述文本，也不落到正文", () => {
    const { container } = render(
      <BlockRenderer
        block={{
          id: "blk_progress",
          type: "progress",
          content: "正在执行工具调用",
          progressData: {
            phase: "implementing",
            progress: 3,
            description: "正在执行工具调用",
            currentStep: "bash",
            steps: [{ name: "bash", status: "in_progress" }],
          },
        }}
      />,
    );

    expect(container.textContent).toBe("");
  });
});
