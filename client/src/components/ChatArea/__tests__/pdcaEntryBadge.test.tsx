/**
 * 批次 14（P2-B，2026-11-24）：PDCA 入口徽标的两形态回归锁。
 *
 * - 进行中 ⇒ 「PDCA 编排」+ 蓝脉冲点；
 * - 本轮结束但仍有 PDCA 可看 ⇒ 「查看结果」+ 静态灰点；
 * - 两形态点击都只开合抽屉，且不冒泡到整条浮动栏（避免误触任务面板）。
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import PdcaEntryBadge from "../PdcaEntryBadge";

describe("PdcaEntryBadge — 指示器两形态（批次 14 P2-B）", () => {
  it("进行中 ⇒ 「PDCA 编排」+ 蓝脉冲点", () => {
    const { container } = render(
      <PdcaEntryBadge active open={false} onToggle={() => {}} />,
    );
    expect(screen.getByText("chat.pdcaBadge")).toBeTruthy();
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "chat.pdcaBadge",
    );
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("终态 ⇒ 「查看结果」+ 静态灰点（不再脉冲）", () => {
    const { container } = render(
      <PdcaEntryBadge active={false} open={false} onToggle={() => {}} />,
    );
    expect(screen.getByText("chat.pdcaViewResult")).toBeTruthy();
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe(
      "chat.pdcaViewResult",
    );
    expect(container.querySelector(".animate-pulse")).toBeNull();
    expect(container.querySelector(".bg-gray-400")).toBeTruthy();
  });

  it("点击开合抽屉且不冒泡到浮动栏", () => {
    const onToggle = vi.fn();
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <PdcaEntryBadge active open={false} onToggle={onToggle} />
      </div>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onParentClick).not.toHaveBeenCalled();
  });
});
