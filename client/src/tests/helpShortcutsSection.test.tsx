/**
 * BUG-09（2026-10-22 复查）：`/help` → 「快捷键」分区此前**只有标题、列表恒为空**
 *
 * 缺陷现场：`HelpPage.renderShortcuts()` 直接把 `KeyboardShortcutsHelp`（**模态**）
 * 放进分区里，而该组件在 `open=false`（默认）时 `return null` —— 于是分区渲染出
 * `<h3>快捷键</h3>` 后再无内容；模态本应由 `App.tsx` 全局挂载 + `Ctrl+/` 唤起。
 *
 * 修法：从模态里抽出纯展示的 `ShortcutList`，HelpPage 引用清单、App 继续持模态。
 * 本文件锁两件事：①清单确实渲染出条目；②HelpPage 的接线不能再指回模态。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ShortcutList } from "../components/common/KeyboardShortcutsHelp";

describe("BUG-09：帮助中心快捷键分区", () => {
  it("ShortcutList 渲染出实际条目（不是空列表）", () => {
    const { container } = render(<ShortcutList />);

    // 9 条快捷键 = 9 行（每条一行 label + 组合键）
    const rows = container.querySelectorAll(".space-y-2 > div");
    expect(rows).toHaveLength(9);

    // 抽查三条文案 + 组合键，确认真实翻译而非裸 key
    expect(screen.getByText("新建会话")).toBeTruthy();
    expect(screen.getByText("显示快捷键帮助")).toBeTruthy();
    expect(screen.getByText("停止生成")).toBeTruthy();
    expect(container.textContent).toContain("Ctrl");
    expect(container.textContent).toContain("Esc");
    expect(container.textContent).not.toContain("common.shortcut");
  });

  it("HelpPage 的快捷键分区接线 ShortcutList（不得复用默认收起的模态）", () => {
    const source = readFileSync(
      join(__dirname, "..", "components", "views", "HelpPage.tsx"),
      "utf-8",
    );
    expect(source).toContain("<ShortcutList />");
    expect(source).not.toContain("<KeyboardShortcutsHelp");
  });
});
