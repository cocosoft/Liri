// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * G8 内容增强：悬浮窗上下文的纯函数语义（当前会话 / 运行中目标的展示模型）。
 *
 * 锁定的语义：
 * - 持久化快照损坏 / 缺字段 / 空串 ⇒ "无当前会话"（不猜）；
 * - 会话标题只在列表**命中同一 id** 时取用，命中但标题为空 ⇒ `null`（不臆造）；
 * - 目标只做展示归一（去空白、预算缺失 ⇒ `null`），不改写状态；
 * - 读取失败 ⇒ `unavailable`，界面不得把它显示成"没有目标"。
 */

import { describe, expect, it } from "vitest";
import type { TaskGoalDto } from "../types/events";
import {
  buildFloatingContext,
  pickSessionTitle,
  readPersistedCurrentSessionId,
} from "../lib/floatingContext";

function goal(partial: Partial<TaskGoalDto> & { id: string }): TaskGoalDto {
  return {
    objective: "完成 X",
    status: "active",
    tokensUsed: 0,
    noProgressStreak: 0,
    createdAt: 1,
    updatedAt: 2,
    ...partial,
  };
}

describe("readPersistedCurrentSessionId", () => {
  it("损坏 / 缺 state / 非字符串 / 空串 ⇒ null", () => {
    expect(readPersistedCurrentSessionId(null)).toBeNull();
    expect(readPersistedCurrentSessionId("")).toBeNull();
    expect(readPersistedCurrentSessionId("{bad")).toBeNull();
    expect(readPersistedCurrentSessionId('{"version":4}')).toBeNull();
    expect(
      readPersistedCurrentSessionId('{"state":{"currentSessionId":123}}'),
    ).toBeNull();
    expect(
      readPersistedCurrentSessionId('{"state":{"currentSessionId":"   "}}'),
    ).toBeNull();
  });

  it("合法快照 ⇒ 取到 id", () => {
    expect(
      readPersistedCurrentSessionId(
        '{"state":{"currentSessionId":"sess-1"},"version":4}',
      ),
    ).toBe("sess-1");
  });
});

describe("pickSessionTitle", () => {
  it("命中取标题；未命中或标题为空 ⇒ null", () => {
    const sessions = [
      { id: "a", title: "会话 A" },
      { id: "b", title: "" },
    ];
    expect(pickSessionTitle(sessions, "a")).toBe("会话 A");
    expect(pickSessionTitle(sessions, "b")).toBeNull();
    expect(pickSessionTitle(sessions, "missing")).toBeNull();
    expect(pickSessionTitle(sessions, null)).toBeNull();
  });
});

describe("buildFloatingContext", () => {
  it("无当前会话 ⇒ session 为 null（不回落第一个会话）", () => {
    const context = buildFloatingContext({
      currentSessionId: null,
      sessions: [{ id: "a", title: "会话 A" }],
      goals: [],
    });
    expect(context.session).toBeNull();
    expect(context.goals).toEqual([]);
    expect(context.unavailable).toBe(false);
  });

  it("有会话 ⇒ 带 id 与命中标题；目标归一（去空白 / 预算缺省 null）", () => {
    const context = buildFloatingContext({
      currentSessionId: "a",
      sessions: [{ id: "a", title: "会话 A" }],
      goals: [
        goal({
          id: "g1",
          objective: "  重构计划模块  ",
          tokensUsed: 1200,
          tokenBudget: 5000,
        }),
        goal({ id: "g2", objective: "补测试", tokensUsed: 30 }),
      ],
    });
    expect(context.session).toEqual({ id: "a", title: "会话 A" });
    expect(context.goals).toEqual([
      {
        id: "g1",
        objective: "重构计划模块",
        tokensUsed: 1200,
        tokenBudget: 5000,
      },
      { id: "g2", objective: "补测试", tokensUsed: 30, tokenBudget: null },
    ]);
  });

  it("unavailable 透传（读取失败不得被当成'没有目标'）", () => {
    const context = buildFloatingContext({
      currentSessionId: null,
      sessions: [],
      goals: [],
      unavailable: true,
    });
    expect(context.unavailable).toBe(true);
  });
});
