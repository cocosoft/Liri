/**
 * 工作台分组结构不变量（2026-10-22 用户反馈驱动）
 *
 * 背景：原本 4 组（9/9/7/5），30 个条目在目录页平铺 —— 超出人一次扫视的容量（7±2），
 * 找功能只能逐张读字。改造为 6 组、每组 ≤6 项，组名即"场景"。
 *
 * 本用例锁住结构本身，防止后续"加一个入口"把组又撑回 9 项：
 *  ① 组数固定为 6，且顺序 = WORKBENCH_GROUPS_META；
 *  ② 每组 1..6 项（上限 6 是本次改造的核心约束）；
 *  ③ 条目总数 = 30 且 id 唯一（防止拆分时漏项/重复登记）；
 *  ④ 工作台条目不得再借用 `settings.*` 命名（这些页只存在于工作台，名字应自己拥有）；
 *  ⑤ 同组内 `order.workbench` 唯一（否则渲染顺序依赖数组下标，改一行就乱）。
 */
import { describe, expect, it } from "vitest";

import {
  NAV_ENTRIES,
  WORKBENCH_GROUPS_META,
  toEnabledModuleIds,
  workbenchGroups,
} from "../navRegistry";

/** 全模块可见（取 NAV_ENTRIES 里声明的全部 moduleId），确保拿到完整 32 项 */
const allModules = NAV_ENTRIES.filter((entry) => entry.moduleId).map(
  (entry) => ({
    id: entry.moduleId as string,
  }),
);
const groups = workbenchGroups(toEnabledModuleIds(allModules));

describe("工作台分组结构（6 组 × ≤6 项）", () => {
  it("组数固定为 6，顺序与 META 一致", () => {
    expect(groups).toHaveLength(6);
    expect(groups.map((group) => group.id)).toEqual(
      WORKBENCH_GROUPS_META.map((group) => group.id),
    );
  });

  it("每组 1..6 项（上限 6 是人一次扫视的容量）", () => {
    for (const group of groups) {
      expect(group.items.length).toBeGreaterThan(0);
      expect(group.items.length).toBeLessThanOrEqual(6);
    }
  });

  it("条目总数 32 且 id 唯一（拆分不漏项、不重复登记）", () => {
    const items = groups.flatMap((group) => group.items);
    expect(items).toHaveLength(32);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    // 工作台条目必须是页面型（无 path 的动作型入口不该出现在目录页）
    expect(items.filter((item) => !item.path)).toEqual([]);
  });

  it("工作台条目不再借用 settings.* 命名", () => {
    const borrowed = groups
      .flatMap((group) => group.items)
      .filter((item) => item.labelKey.startsWith("settings."));
    expect(borrowed.map((item) => `${item.id} → ${item.labelKey}`)).toEqual([]);
  });

  it("同组内 order.workbench 唯一（渲染顺序不依赖数组下标）", () => {
    for (const group of groups) {
      const orders = group.items.map((item) => item.order?.workbench ?? 0);
      expect(new Set(orders).size).toBe(orders.length);
    }
  });
});
