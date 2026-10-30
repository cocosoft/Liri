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

/**
 * B2（2026-10-30）：按轮摘要由后端一次供给 —— 测试里替换成可控返回值
 * （空数组 = 端点不可用，行为退回 B1）。
 */
const remoteState = vi.hoisted(() => ({
  rounds: [] as Array<{
    roundIndex: number;
    userMsgId: string;
    userMsg: string;
    assistantMsg: string;
    timestamp: number;
  }>,
}));
vi.mock("../../../hooks/useSessionRoundSummaries", () => ({
  useSessionRoundSummaries: () => remoteState.rounds,
}));

import RoundNavigator from "../RoundNavigator";
import type { Message } from "../../../types";
import { useChatInspectorStore } from "../../../stores/chatInspectorStore";

/** jsdom 不实现 scrollIntoView（组件用它把当前轮滚入窄列视野） */
beforeEach(() => {
  cleanup();
  Element.prototype.scrollIntoView = vi.fn();
  useChatInspectorStore.setState({ highlightedRoundId: null });
  remoteState.rounds = [];
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

function setup(count = 26, totalRounds = count, messages?: Message[]) {
  const containerRef = createRef<HTMLDivElement>();
  render(
    <div ref={containerRef}>
      <RoundNavigator
        messages={messages ?? buildMessages(count)}
        isStreaming={false}
        containerRef={containerRef}
        totalRounds={totalRounds}
        hasOlder={false}
        onLoadOlder={() => {}}
      />
    </div>,
  );
}

/** 只加载轮次区间 [from, to] 的消息（模拟尾部分页：26 轮会话只加载后 9 轮） */
function buildRange(from: number, to: number): Message[] {
  const list: Message[] = [];
  for (let i = from; i <= to; i++) {
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

describe("RoundNavigator（B2）：未加载轮次也有摘要", () => {
  /** 后端一次供给的整会话摘要（26 轮，绝对轮号） */
  function remoteAll(total: number) {
    return Array.from({ length: total }, (_, i) => ({
      roundIndex: i + 1,
      userMsgId: `u${i + 1}`,
      userMsg: `第${i + 1}轮问题`,
      assistantMsg: "",
      timestamp: 1_700_000_000_000 + (i + 1) * 1000,
    }));
  }

  it("尾部只加载 9 轮时，26 轮全部有摘要（前端不为每轮各发请求）", () => {
    remoteState.rounds = remoteAll(26);
    setup(9, 26, buildRange(18, 26));
    expect(screen.getAllByText(/^第\d+轮问题$/)).toHaveLength(26);
    // 未加载的 1..17 轮渲染为只读行
    expect(
      document.querySelectorAll('[data-round-unloaded="true"]'),
    ).toHaveLength(17);
  });

  it("轮号用绝对轮号（已加载首轮 = #18，与右侧消息摘要同口径）", () => {
    remoteState.rounds = remoteAll(26);
    setup(9, 26, buildRange(18, 26));
    expect(screen.getByText("18")).toBeTruthy();
    expect(screen.getByText("26")).toBeTruthy();
  });

  it("未加载轮不提供点击（目标消息不在虚拟列表，无法定位）", () => {
    remoteState.rounds = remoteAll(26);
    setup(9, 26, buildRange(18, 26));
    const unloaded = document.querySelectorAll('[data-round-unloaded="true"]');
    expect(unloaded[0].querySelector("button")).toBeNull();
    expect(useChatInspectorStore.getState().highlightedRoundId).toBeNull();
  });

  it("端点不可用（空数组）⇒ 退回只显示已加载轮次", () => {
    remoteState.rounds = [];
    setup(9, 26, buildRange(18, 26));
    const buttons = screen
      .getAllByRole("button")
      .filter((b) => (b.getAttribute("aria-label") ?? "").includes("roundNav"));
    expect(buttons).toHaveLength(9);
    expect(
      document.querySelectorAll('[data-round-unloaded="true"]'),
    ).toHaveLength(0);
  });
});
