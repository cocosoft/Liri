// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 批次 5 / C2（2026-11-24）：任务状态展示表的完整性守卫。
 *
 * 缺口：5 处各维护一份图标/颜色表 ⇒ 新增状态（如 `skipped`）总有一两处漏改。
 * 本用例锁住"每个状态都有图标/颜色/文案键"，并验证进度卡 `done` 别名归一。
 */
import { describe, expect, it } from "vitest";
import type { TaskCardTask } from "@/types";
import {
  DAG_STATUS_COLORS,
  TASK_STATUS_STYLES,
  getTaskStatusStyle,
} from "../taskStatus";

const ALL_STATUSES: TaskCardTask["status"][] = [
  "pending",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
  "blocked",
  "skipped",
];

describe("taskStatus 常量表", () => {
  it("每个任务状态都有图标 / 颜色 / 文案键（不漏 skipped）", () => {
    for (const status of ALL_STATUSES) {
      const style = TASK_STATUS_STYLES[status];
      expect(style, `缺少状态样式: ${status}`).toBeDefined();
      expect(style.icon.length).toBeGreaterThan(0);
      expect(style.color.length).toBeGreaterThan(0);
      expect(style.labelKey.startsWith("chat.")).toBe(true);
    }
  });

  it("每个任务状态都有 DAG 配色（bg/border/text 均非空）", () => {
    for (const status of ALL_STATUSES) {
      const colors = DAG_STATUS_COLORS[status];
      expect(colors, `缺少 DAG 配色: ${status}`).toBeDefined();
      expect(colors.bg.length).toBeGreaterThan(0);
      expect(colors.border.length).toBeGreaterThan(0);
      expect(colors.text.length).toBeGreaterThan(0);
    }
  });

  it("进度卡的 `done` 别名归一为 completed；未知取值回退 pending", () => {
    expect(getTaskStatusStyle("done")).toEqual(TASK_STATUS_STYLES.completed);
    expect(getTaskStatusStyle("nonsense")).toEqual(TASK_STATUS_STYLES.pending);
  });
});
