// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * ToolsPanel 组件测试（P3，2026-10-16 工具治理）
 *
 * 断言四件（方案 §3.5「每行必备 4 件」+ §8 边界）：
 *   ① 行渲染：工具名 / 类别 / 可见状态 / **结构化原因**徽标（中文文案来自 zh 字典 ⇒ 缺键即失败）
 *   ② 三态控件：点击「强制可见」⇒ 调 `setVisibilityOverrides`，参数为 `{ [name]: 'on' }`
 *   ③ 风险二次确认：高风险工具**先弹确认**（文案含"可见不代表放行"），确认后才写
 *   ④ `conditional` 行：显示"未进生效工具面"提示；若已被 on 则显示"已开启但无效"（不给假承诺）
 *
 * i18n：覆盖 `react-i18next` 为**真实 i18n 实例**（默认 zh）—— 与 `trajectory-detail.test.tsx`
 * 同法 ⇒ 本测试同时是**文案键存在性守卫**。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import i18n from "../../../i18n";
import type { SharedToolVisibilityEntry } from "@shared/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      String(i18n.t(key, opts as never)),
    i18n: { changeLanguage: () => Promise.resolve(), language: "zh" },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const visibility = vi.fn();
const getVisibilityOverrides = vi.fn();
const setVisibilityOverrides = vi.fn();

vi.mock("../../../services/toolService", () => ({
  toolService: {
    visibility: (...a: unknown[]) => visibility(...a),
    getVisibilityOverrides: (...a: unknown[]) => getVisibilityOverrides(...a),
    setVisibilityOverrides: (...a: unknown[]) => setVisibilityOverrides(...a),
  },
}));

import ToolsPanel from "../ToolsPanel";

const REPORTS: SharedToolVisibilityEntry[] = [
  {
    name: "file_read",
    category: "file",
    registration: "registered",
    visibleByDefault: true,
    effective: "visible",
    reasons: [],
    risk: "low",
  },
  {
    name: "bash",
    category: "shell",
    registration: "registered",
    visibleByDefault: true,
    effective: "visible",
    reasons: [],
    risk: "high",
  },
  {
    name: "computer_use",
    category: "misc",
    registration: "registered",
    visibleByDefault: false,
    effective: "hidden",
    reasons: ["archived"],
    risk: "high",
  },
  {
    name: "pdf",
    category: "misc",
    registration: "conditional",
    visibleByDefault: false,
    effective: "hidden",
    reasons: ["unregistered-category", "conditional"],
    risk: "high",
  },
];

beforeEach(() => {
  visibility.mockReset().mockResolvedValue(REPORTS);
  getVisibilityOverrides.mockReset().mockResolvedValue({});
  setVisibilityOverrides.mockReset().mockResolvedValue(true);
});

describe("ToolsPanel：报表渲染（解释「为什么不可见」）", () => {
  it("渲染全量工具行 + 结构化原因徽标（中文文案来自 zh 字典）", async () => {
    render(<ToolsPanel isDark={false} />);

    await waitFor(() => {
      expect(screen.getByText("file_read")).toBeDefined();
    });
    for (const name of ["bash", "computer_use", "pdf"]) {
      expect(screen.getByText(name)).toBeDefined();
    }
    // 结构化原因 → 中文徽标（缺键 ⇒ 本断言失败 ⇒ 键存在性守卫）
    expect(screen.getAllByText("有意归档（需显式开启）").length).toBe(1);
    expect(screen.getAllByText("未进生效工具面").length).toBe(1);
    // 状态徽标（可见 / 不可见）
    expect(screen.getAllByText("可见").length).toBeGreaterThan(0);
    expect(screen.getAllByText("不可见").length).toBeGreaterThan(0);
  });

  it("conditional 行标注「未进本构建的生效工具面」，且仍可切三态（Q3 未禁用）", async () => {
    render(<ToolsPanel isDark={false} />);
    await waitFor(() => expect(screen.getByText("pdf")).toBeDefined());

    expect(
      screen.getByText(
        "未进本构建的生效工具面（可能未接线，或工厂内的功能开关默认关闭）⇒ 覆写不会生效。",
      ),
    ).toBeDefined();
    // 「强制可见」按钮在 pdf 行内**未禁用**（Q3：评估期不禁用，避免挡住用户主动启用）
    const buttons = screen.getAllByRole("button", { name: "强制可见" });
    expect(buttons.length).toBe(REPORTS.length);
    for (const b of buttons)
      expect((b as HTMLButtonElement).disabled).toBe(false);
  });

  it("后端不可用（报表空）⇒ 如实报错，不渲染假行", async () => {
    visibility.mockResolvedValue([]);
    render(<ToolsPanel isDark={false} />);
    await waitFor(() => {
      expect(
        screen.getByText("读取工具可见性失败（后端未就绪或接口不可达）"),
      ).toBeDefined();
    });
    expect(screen.queryByText("file_read")).toBeNull();
  });
});

describe("ToolsPanel：三态覆写（写 settings.tools）", () => {
  it("低风险工具：点「强制可见」直接落盘（无二次确认）", async () => {
    render(<ToolsPanel isDark={false} />);
    await waitFor(() => expect(screen.getByText("file_read")).toBeDefined());

    // 分组顺序 = 已强制开启 / 默认可见 / 不可见 / 已强制关闭 ⇒ 第 0 个按钮属默认可见组的 file_read
    fireEvent.click(screen.getAllByRole("button", { name: "强制可见" })[0]);

    await waitFor(() => {
      expect(setVisibilityOverrides).toHaveBeenCalledWith({ file_read: "on" });
    });
  });

  it("高风险工具：**先二次确认**（文案含「可见不代表放行」），确认后才写", async () => {
    render(<ToolsPanel isDark={false} />);
    await waitFor(() => expect(screen.getByText("computer_use")).toBeDefined());

    // 第 3 行 = computer_use（高风险）；点其「强制可见」
    fireEvent.click(screen.getAllByRole("button", { name: "强制可见" })[2]);

    const confirmText =
      "可见不代表放行：开启后模型能看到并申请调用该工具，但实际执行仍需你逐次审批，且受文件路径与沙箱限制。";
    await waitFor(() => expect(screen.getByText(confirmText)).toBeDefined());
    // 未确认 ⇒ 不落盘
    expect(setVisibilityOverrides).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认开启" }));
    await waitFor(() => {
      expect(setVisibilityOverrides).toHaveBeenCalledWith({
        computer_use: "on",
      });
    });
  });

  it("取消二次确认 ⇒ 不落盘", async () => {
    render(<ToolsPanel isDark={false} />);
    await waitFor(() => expect(screen.getByText("computer_use")).toBeDefined());
    fireEvent.click(screen.getAllByRole("button", { name: "强制可见" })[2]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "确认开启" })).toBeDefined(),
    );
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(setVisibilityOverrides).not.toHaveBeenCalled();
  });

  it("`on` 对 conditional 无效 ⇒ 显示「已开启但无效」，不谎报已开启", async () => {
    getVisibilityOverrides.mockResolvedValue({ pdf: "on" });
    render(<ToolsPanel isDark={false} />);
    await waitFor(() => {
      expect(screen.getByText("已开启但无效")).toBeDefined();
    });
    // 该行仍显示「不可见」（如实反映 effective）
    const pdfRow = screen.getByText("pdf").closest("div.px-3")!;
    expect(pdfRow.textContent).toContain("不可见");
  });

  it("强制不可见 ⇒ 写 off", async () => {
    render(<ToolsPanel isDark={false} />);
    await waitFor(() => expect(screen.getByText("file_read")).toBeDefined());
    fireEvent.click(screen.getAllByRole("button", { name: "强制不可见" })[0]);
    await waitFor(() => {
      expect(setVisibilityOverrides).toHaveBeenCalledWith({ file_read: "off" });
    });
  });

  /**
   * BUG-2 回归（2026-10-16 P3 真机复验发现）：保存成功后**必须重拉报表**再渲染。
   *
   * 真机现场：点「确认开启」后只更新了本地 `overrides`，而 `entry.effective` 仍是后端旧值 ⇒
   * 分组与徽标按陈旧判定渲染（出现"已开启但无效"），**必须手动刷新页面**才正确。
   * 本用例用"第二次 `visibility()` 返回已更新的报表"钉住该行为（不回退即红）。
   */
  it("保存成功后自动重拉报表 ⇒ 分组/统计立即正确（BUG-2 回归）", async () => {
    const after = REPORTS.map((e) =>
      e.name === "file_read"
        ? { ...e, reasons: ["user-on-bypass" as const] }
        : e,
    );
    visibility.mockResolvedValueOnce(REPORTS).mockResolvedValueOnce(after);

    render(<ToolsPanel isDark={false} />);
    await waitFor(() => expect(screen.getByText("file_read")).toBeDefined());

    // file_read 为低风险 ⇒ 直写，无二次确认
    fireEvent.click(screen.getAllByRole("button", { name: "强制可见" })[0]);

    await waitFor(() => {
      expect(screen.getByText("已强制开启 · 1")).toBeDefined();
    });
    expect(visibility).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("已开启但无效")).toBeNull();
  });
});
