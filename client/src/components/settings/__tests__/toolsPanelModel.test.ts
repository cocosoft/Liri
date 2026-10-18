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
 * 工具可见性面板**纯逻辑**测试（P3，2026-10-16 工具治理）
 *
 * 锁四条（对齐方案 §3.5「每行必备 4 件」与 §8 边界）：
 *   ① **不给假承诺**：`on` 对未进生效工具面（`conditional`）无效 ⇒ 该行归「不可见」组；
 *   ② **二次确认判据**：仅"高风险 + 新开为可见"需要确认（关掉 / 中低风险不打扰）；
 *   ③ **三态流转**：`auto` ⇒ **删除键**（与后端"只含 on/off"的归一化口径一致）；
 *   ④ **原因穷尽映射**：7 个原因各有文案键与色调（枚举新增 ⇒ 编译失败，见 Map 的 `Record` 类型）。
 */

import { describe, expect, it } from "vitest";
import type { SharedToolVisibilityReason } from "@shared/types";
import {
  TOOL_VISIBILITY_REASON_KEYS,
  TOOL_VISIBILITY_REASON_TONES,
  filterEntries,
  groupOf,
  overrideValueOf,
  primaryReasonOf,
  requiresRiskConfirm,
  summarize,
  withOverride,
} from "../toolsPanelModel";
import type { SharedToolVisibilityEntry } from "@shared/types";

function entry(
  patch: Partial<SharedToolVisibilityEntry> & { name: string },
): SharedToolVisibilityEntry {
  return {
    category: "file",
    registration: "registered",
    visibleByDefault: true,
    effective: "visible",
    reasons: [],
    risk: "low",
    ...patch,
  };
}

describe("P3 分组判据（派生，不按类别手写）", () => {
  it("默认可见 ⇒ default；强制可见且生效 ⇒ on；强制关闭 ⇒ off", () => {
    const e = entry({ name: "file_read" });
    expect(groupOf(e, {})).toBe("default");
    expect(groupOf(e, { file_read: "on" })).toBe("on");
    expect(groupOf(e, { file_read: "off" })).toBe("off");
  });

  it("默认不可见 ⇒ hidden（归档 / 不在白名单 / 未登记类别同此）", () => {
    const e = entry({
      name: "computer_use",
      category: "misc",
      visibleByDefault: false,
      effective: "hidden",
      reasons: ["archived"],
      risk: "high",
    });
    expect(groupOf(e, {})).toBe("hidden");
  });

  it("**开启但无效**（conditional：未进生效工具面）⇒ 仍归 hidden，不谎报已开启", () => {
    const e = entry({
      name: "pdf",
      category: "misc",
      registration: "conditional",
      visibleByDefault: false,
      effective: "hidden",
      reasons: ["unregistered-category", "conditional"],
      risk: "high",
    });
    expect(groupOf(e, { pdf: "on" })).toBe("hidden");
  });
});

describe("P3 二次确认判据（高风险 × 新开为可见）", () => {
  it("高风险 + on ⇒ 需确认；高风险 + off / auto ⇒ 不打扰", () => {
    const high = entry({ name: "bash", category: "shell", risk: "high" });
    expect(requiresRiskConfirm(high, "on")).toBe(true);
    expect(requiresRiskConfirm(high, "off")).toBe(false);
    expect(requiresRiskConfirm(high, "auto")).toBe(false);
  });

  it("中 / 低风险 + on ⇒ 不确认", () => {
    expect(
      requiresRiskConfirm(entry({ name: "file_write", risk: "medium" }), "on"),
    ).toBe(false);
    expect(
      requiresRiskConfirm(entry({ name: "glob", risk: "low" }), "on"),
    ).toBe(false);
  });
});

describe("P3 三态流转（不可变 + auto 删键）", () => {
  it("auto ⇒ 删除该键（只含 on/off，与后端归一化同口径）", () => {
    const next = withOverride({ bash: "on", glob: "off" }, "bash", "auto");
    expect(next).toEqual({ glob: "off" });
    expect(Object.keys(next)).not.toContain("bash");
  });

  it("原表不被修改（不可变）", () => {
    const base = { bash: "on" as const };
    withOverride(base, "bash", "off");
    expect(base).toEqual({ bash: "on" });
  });

  it("overrideValueOf：缺省 / 非法值一律 ⇒ auto", () => {
    expect(overrideValueOf({}, "bash")).toBe("auto");
    expect(
      overrideValueOf(
        { bash: "bogus" } as unknown as Record<string, "on" | "off">,
        "bash",
      ),
    ).toBe("auto");
    expect(overrideValueOf({ bash: "off" }, "bash")).toBe("off");
  });
});

describe("P3 搜索 / 统计", () => {
  const entries = [
    entry({ name: "file_read", category: "file" }),
    entry({
      name: "computer_use",
      category: "misc",
      effective: "hidden",
      visibleByDefault: false,
      reasons: ["archived"],
      risk: "high",
    }),
    entry({
      name: "pdf",
      category: "misc",
      registration: "conditional",
      effective: "hidden",
      visibleByDefault: false,
      reasons: ["conditional"],
      risk: "high",
    }),
  ];

  it("按名字 / 类别 / 原因词过滤（大小写不敏感；空查询返回全量）", () => {
    expect(filterEntries(entries, "").length).toBe(3);
    expect(filterEntries(entries, "FILE_READ").map((e) => e.name)).toEqual([
      "file_read",
    ]);
    expect(filterEntries(entries, "misc").length).toBe(2);
    expect(filterEntries(entries, "conditional").map((e) => e.name)).toEqual([
      "pdf",
    ]);
  });

  it("统计：可见数 / 强制开启 / 强制关闭 / 未接线数", () => {
    const s = summarize(entries, { file_read: "on", computer_use: "off" });
    expect(s.total).toBe(3);
    expect(s.visible).toBe(1);
    expect(s.forcedOn).toBe(1);
    expect(s.forcedOff).toBe(1);
    expect(s.conditional).toBe(1);
  });

  it("未接线工具即便被 on 也不计入「强制开启」（如实）", () => {
    const s = summarize(entries, { pdf: "on" });
    expect(s.forcedOn).toBe(0);
    expect(s.visible).toBe(1); // 仅 file_read
  });
});

describe("P3 原因穷尽映射", () => {
  const ALL_REASONS: SharedToolVisibilityReason[] = [
    "mandatory",
    "archived",
    "unregistered-category",
    "not-in-task-whitelist",
    "conditional",
    "user-off",
    "user-on-bypass",
  ];

  it("7 个原因各有文案键与色调（均以 settings. 起头）", () => {
    expect(Object.keys(TOOL_VISIBILITY_REASON_KEYS).sort()).toEqual(
      [...ALL_REASONS].sort(),
    );
    expect(Object.keys(TOOL_VISIBILITY_REASON_TONES).sort()).toEqual(
      [...ALL_REASONS].sort(),
    );
    for (const r of ALL_REASONS) {
      expect(TOOL_VISIBILITY_REASON_KEYS[r].startsWith("settings.")).toBe(true);
    }
  });
});

describe("I-4：单行只显示一个主因（conditional 优先）", () => {
  it("同时命中未登记类别与 conditional ⇒ 主因取 conditional", () => {
    const e = entry({
      name: "kanban",
      category: "misc",
      registration: "conditional",
      visibleByDefault: false,
      effective: "hidden",
      reasons: ["unregistered-category", "conditional"],
    });
    expect(primaryReasonOf(e)).toBe("conditional");
  });

  it("无原因（常规可见）⇒ null；强制开启绕过白名单 ⇒ user-on-bypass", () => {
    expect(primaryReasonOf(entry({ name: "file_read" }))).toBeNull();
    expect(
      primaryReasonOf(
        entry({ name: "pdf", reasons: ["not-in-task-whitelist", "user-on-bypass"] }),
      ),
    ).toBe("not-in-task-whitelist");
  });
});
