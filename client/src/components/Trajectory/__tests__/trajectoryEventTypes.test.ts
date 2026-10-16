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
 * 轨迹面板**类型候选 / 类型标签**的守则测试（2026-10-16，台账 `TRAJECTORY-TYPE-FILTER-DYNAMIC`）。
 *
 * 背景：类型筛选按钮原为**静态 21 项手写清单**，只覆盖事件名清单(54)的 39%，且真机最吵的
 * `metric/timing`（6.5%）与 `request/start`（3.3%）**不在其中**（面板每 1000 条约 98 行无法
 * 按类型隐藏）；类型标签又是另一份 18 项手写清单（12 个按钮无中文标签、9 个标签无按钮）。
 * 现改为：候选由**已加载事件**派生（`countEventTypes`），标签走单一实现（`trajectoryTypeLabel`）。
 *
 * 本文件钉住：
 *   ① 候选按出现次数降序、同次数字典序（结果确定，不随 Map 插入顺序抖动）
 *   ② **最吵的类型必定成为候选**（回归：它们此前无按钮）
 *   ③ 标签：命中 i18n 键 → 翻译；未命中 → 回落原始 type 串，且对 `LIRI_EVENT_NAMES`
 *      任一成员都返回**非空**（防"按钮/行内空白标签"）
 */

import { describe, expect, it } from "vitest";
import { LIRI_EVENT_NAMES } from "@shared/events/eventNames";
import type { LiriEvent } from "@/types";
import {
  countEventTypes,
  trajectoryTypeLabel,
} from "../trajectoryEventTypes";

function ev(seq: number, type: string): LiriEvent {
  return {
    type: type as LiriEvent["type"],
    seq,
    time: 1000 + seq,
    sessionId: "sid-types",
    data: {} as never,
  };
}

/** 假 t：把键包成 `T(...)`，用于断言"命中键才走翻译" */
const fakeT = (key: string): string => `T(${key})`;

describe("countEventTypes — 动态候选派生", () => {
  it("空事件 ⇒ 空候选", () => {
    expect(countEventTypes([])).toEqual([]);
  });

  it("按出现次数降序；同次数按类型名字典序（结果确定）", () => {
    const events = [
      ev(1, "assistant/text"),
      ev(2, "metric/timing"),
      ev(3, "metric/timing"),
      ev(4, "request/start"),
      ev(5, "request/start"),
      ev(6, "request/start"),
      ev(7, "assistant/text"),
      ev(8, "zzz/none"),
    ];
    expect(countEventTypes(events)).toEqual([
      { type: "request/start", count: 3 },
      // 同为 2 次 ⇒ 按类型名字典序（"assistant/text" < "metric/timing"）
      { type: "assistant/text", count: 2 },
      { type: "metric/timing", count: 2 },
      { type: "zzz/none", count: 1 },
    ]);
  });

  it("回归：最吵的两类（metric/timing / request/start）必定出现在候选里", () => {
    const events = [
      ev(1, "turn/start"),
      ev(2, "metric/timing"),
      ev(3, "request/start"),
      ev(4, "assistant/thinking"),
    ];
    const types = countEventTypes(events).map((o) => o.type);
    expect(types).toContain("metric/timing");
    expect(types).toContain("request/start");
  });
});

describe("trajectoryTypeLabel — 类型标签单一实现", () => {
  it("命中 i18n 键 ⇒ 走翻译", () => {
    expect(trajectoryTypeLabel("assistant/text", fakeT)).toBe(
      "T(trajectory.type.reply)",
    );
    expect(trajectoryTypeLabel("metric/timing", fakeT)).toBe(
      "T(trajectory.type.metricTiming)",
    );
  });

  it("未命中 ⇒ 回落原始 type 串（任何类型都有可读标签）", () => {
    expect(trajectoryTypeLabel("assistant/deliverable", fakeT)).toBe(
      "assistant/deliverable",
    );
    expect(trajectoryTypeLabel("goal/injected", fakeT)).toBe("goal/injected");
  });

  it("守则：shared 名单任一成员都不得返回空标签", () => {
    for (const name of LIRI_EVENT_NAMES) {
      expect(trajectoryTypeLabel(name, fakeT).length).toBeGreaterThan(0);
    }
  });
});
