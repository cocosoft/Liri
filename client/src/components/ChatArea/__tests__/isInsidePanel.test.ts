/**
 * `isInsidePanel` 单测（台账 2026-10-19「SessionHistorySidebar 无独立单测」补漏）
 *
 * 回归目标：`MouseEvent.relatedTarget` 不保证是 Node（可能是 `window` / `null` / 普通对象），
 * 直接传给 `Element.contains` 会抛 `TypeError: parameter 1 is not of type 'Node'`。
 * 本用例锁住"非 Node ⇒ false 且不抛错"，以及"面板内后代 ⇒ true / 面板外 ⇒ false"。
 */
import { describe, expect, it } from "vitest";

import { isInsidePanel } from "../sidebarPanelHitTest";

describe("isInsidePanel（mouseleave 后代判定）", () => {
  it("面板内的后代 ⇒ true（含 fixed 定位元素，只要是 DOM 后代）", () => {
    const panel = document.createElement("div");
    const fixedMenu = document.createElement("div");
    fixedMenu.style.position = "fixed";
    panel.appendChild(fixedMenu);
    expect(isInsidePanel(panel, fixedMenu)).toBe(true);
  });

  it("面板外的节点 ⇒ false", () => {
    const panel = document.createElement("div");
    expect(isInsidePanel(panel, document.createElement("span"))).toBe(false);
  });

  it("relatedTarget 非 Node（null / window / 普通对象）⇒ false 且不抛错", () => {
    const panel = document.createElement("div");
    expect(isInsidePanel(panel, null)).toBe(false);
    expect(isInsidePanel(panel, undefined)).toBe(false);
    expect(isInsidePanel(panel, window)).toBe(false);
    expect(isInsidePanel(panel, { nodeType: 1 })).toBe(false);
  });

  it("面板未挂载（null / undefined）⇒ false", () => {
    const child = document.createElement("div");
    expect(isInsidePanel(null, child)).toBe(false);
    expect(isInsidePanel(undefined, child)).toBe(false);
  });
});
