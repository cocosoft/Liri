/**
 * B1（2026-10-30，一致性核查 §9.4）：左侧轮次导航「常显 + 每轮摘要」契约。
 *
 * 真机缺陷（2026-10-30 只读核对）：
 * - 默认只是一根 12×48px 胶囊，`26` 的 `opacity: 0` ⇒ 进会话看不到有哪些轮；
 * - 必须 hover 才展开；用户问题只存在**原生 `title`** 里（不可聚焦、不可控）。
 *
 * 本用例钉住 B1 的三条验收：
 *   ① 进入即见（无需 hover/点击）——轮号与截断摘要都在 DOM 里；
 *   ② 不再使用原生 `title` 承载摘要（改用自定义浮层，hover/focus 触发）；
 *   ③ 点击轮号仍然跳转（写入 `chatInspectorStore.highlightedRoundId`）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { createRef } from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import RoundNavigator from "../RoundNavigator";
import type { Message } from "../../../types";
import { useChatInspectorStore } from "../../../stores/chatInspectorStore";

/** jsdom 不实现 scrollIntoView（组件用它把当前轮滚入窄列视野） */
beforeEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = vi.fn();
  useChatInspectorStore.setState({ highlightedRoundId: null });
});

function buildMessages(count: number): Message[] {
  const list: Message[] = [];
  for (let i = 1; i <= count; i++) {
    list.push({
      id: `u${i}`,
      role: "user",
      content: `第${i}轮问题`,
      timestamp: 1_700_000_000_000 + i * 1000,
    } as Message);
    list.push({
      id: `a${i}`,
      role: "assistant",
      content: `第${i}轮回答`,
      timestamp: 1_700_000_000_500 + i * 1000,
    } as Message);
  }
  return list;
}

function setup(count = 26, totalRounds = count) {
  const containerRef = createRef<HTMLDivElement>();
  render(
    <div ref={containerRef}>
      <RoundNavigator
        messages={buildMessages(count)}
        isStreaming={false}
        containerRef={containerRef}
        totalRounds={totalRounds}
        hasOlder={false}
        onLoadOlder={() => {}}
      />
    </div>,
  );
}

describe("RoundNavigator（B1）：常显轮次 + 截断摘要", () => {
  it("进入即有 26 个轮号按钮（无需 hover/点击）", () => {
    setup(26);
    const buttons = screen
      .getAllByRole("button")
      .filter((b) => (b.getAttribute("aria-label") ?? "").includes("roundNav"));
    expect(buttons).toHaveLength(26);
  });

  it("每轮行内显示用户问题摘要（不是原生 title）", () => {
    setup(3);
    expect(screen.getByText("第1轮问题")).toBeTruthy();
    expect(screen.getByText("第3轮问题")).toBeTruthy();
    // 原生 title 已移除（摘要改由自定义浮层承载）
    const roundButton = screen
      .getAllByRole("button")
      .find((b) => (b.getAttribute("aria-label") ?? "").includes("roundNav"));
    expect(roundButton?.getAttribute("title")).toBeNull();
  });

  it("点击轮号 ⇒ 写入 highlightedRoundId（跳转链路不变）", () => {
    setup(3);
    const first = screen
      .getAllByRole("button")
      .find((b) => (b.getAttribute("aria-label") ?? "").includes("roundNav"));
    fireEvent.click(first!);
    expect(useChatInspectorStore.getState().highlightedRoundId).toBe("u1");
  });

  it("仅 1 轮 ⇒ 不渲染导航（保持既有门槛）", () => {
    setup(1);
    const buttons = screen
      .queryAllByRole("button")
      .filter((b) => (b.getAttribute("aria-label") ?? "").includes("roundNav"));
    expect(buttons).toHaveLength(0);
  });
});
