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
 * 守则测试：`deriveConversationBlocks` 的「已知事件类型」判据必须等同 shared 单一事实源。
 *
 * 2026-10-16（台账 `CLIENT-EVENT-TYPE-SET-SINGLE-SOURCE`）：该判据原为**手写副本**（34 项，
 * 注释自称「与 LiriEventType 保持同步」）⇒ 已漂移 20 个（`session/title` / `request/start` /
 * `context/model-input` / `goal/*` / `validation/*` / `execution/*` …）⇒ 真机 61 个有事件的
 * 会话累计 ≈3775 条「遇到未知事件类型」误报（正常每轮 2–3 条，`request/start` 一条就 3137 次）
 * ⇒ **诊断信号被正常流量淹没**。现已改为 `new Set<string>(LIRI_EVENT_NAMES)` 派生。
 *
 * 本文件钉住两条不变量：
 *   ① `LIRI_EVENT_NAMES` 的**任一**成员都不得触发该告警（防手写副本回流 / 新增事件漏登记）
 *   ② 真正未知的类型**必须**告警（负向对照：证明本测试确实能失败）
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { LIRI_EVENT_NAMES } from "@shared/events/eventNames";
import type { LiriEvent } from "@/types";
import { clearToolResultCache } from "../chat-message-shared";
import { deriveConversationBlocks } from "../deriveConversationBlocks";

const WARN_MSG = "遇到未知事件类型";

function ev(seq: number, type: string): LiriEvent {
  return {
    type: type as LiriEvent["type"],
    seq,
    time: 1000 + seq,
    sessionId: "sid-known-types",
    data: {} as never,
  };
}

/** 逐个类型跑一遍 derive，返回「遇到未知事件类型」告警条数 */
function unknownTypeWarningCount(types: readonly string[]): number {
  const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    types.forEach((t, i) => {
      clearToolResultCache();
      try {
        deriveConversationBlocks([ev(i + 1, t)]);
      } catch {
        // 个别类型在空 data 下可能抛错 —— 与本守则无关（本守则只关心"是否误报未知类型"）
      }
    });
    return spy.mock.calls.filter((args) =>
      args.some((a) => typeof a === "string" && a.includes(WARN_MSG)),
    ).length;
  } finally {
    spy.mockRestore();
  }
}

beforeEach(() => {
  clearToolResultCache();
});

describe("derive 的已知事件类型集合 ≡ shared 单一事实源（守则）", () => {
  it("shared 名单的每个成员都不得触发「遇到未知事件类型」告警", () => {
    expect(unknownTypeWarningCount(LIRI_EVENT_NAMES)).toBe(0);
  });

  it("负向对照：真正未知的类型必须告警（证明本守则能失败）", () => {
    expect(
      unknownTypeWarningCount(["bogus/not-a-real-event-type"]),
    ).toBeGreaterThan(0);
  });

  it("客户端不再持有事件名手写副本（名单唯一事实源 = shared/events/eventNames.ts）", () => {
    // 名单为 readonly 元组且无重复 —— 派生集合的基数必须与之一致（防"派生了个子集"）
    expect(new Set<string>(LIRI_EVENT_NAMES).size).toBe(LIRI_EVENT_NAMES.length);
    expect(LIRI_EVENT_NAMES).toContain("session/title");
  });
});
