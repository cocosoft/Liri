/**
 * 工作台导航「人能找得到」改造 —— 接线锁（2026-10-22）
 *
 * **现场**：侧栏「工作台」展开后在**窄图标栏**里平铺 30 个条目（4 组 / 组标题 10px /
 * `max-h-[55vh]` 滚动），与整页目录 `/workbench` 重复 —— 用户反馈"眼睛看花也找不到对应功能"。
 *
 * 本用例锁四件事：
 *  ① 侧栏不再有内联展开块，按钮直达 `WORKBENCH_PATH`（一处工作面）；
 *  ② 移动底栏的「工作台」同样改为跳转，不再弹抽屉；
 *  ③ 目录页具备「搜索 / 最近使用 / 分组收起」三件套；
 *  ④ 分组默认只展开第一组（否则又回到"30 项同时铺开"）。
 *
 * **为什么用源码扫描**：`Sidebar` 依赖 6+ 个 store / 路由 / 主题上下文，渲染成本与脆弱度都高；
 * 本仓既有同类手法（`Sidebar/__tests__/systemItemsOverride.test.ts`）。
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SIDEBAR = resolve(__dirname, "../../Sidebar/Sidebar.tsx");
const DIRECTORY = resolve(
  __dirname,
  "../../workbench/WorkbenchDirectoryPage.tsx",
);
const NAV_REGISTRY = resolve(__dirname, "../../../config/navRegistry.ts");

const sidebarSrc = readFileSync(SIDEBAR, "utf-8");
const directorySrc = readFileSync(DIRECTORY, "utf-8");
const navRegistrySrc = readFileSync(NAV_REGISTRY, "utf-8");

describe("工作台入口：侧栏 / 移动底栏 → 整页目录", () => {
  it("侧栏不再内联展开 30 项（无 showManagement 抽屉）", () => {
    expect(sidebarSrc).not.toContain("showManagement");
  });

  it("侧栏「工作台」按钮直达 WORKBENCH_PATH", () => {
    expect(sidebarSrc).toContain("navigate(WORKBENCH_PATH)");
    expect(sidebarSrc).toContain("WORKBENCH_PATH,");
  });

  it("移动底栏「工作台」不再弹抽屉，改为跳转", () => {
    expect(sidebarSrc).not.toContain("setWorkbenchOpen");
    expect(sidebarSrc).toContain("openWorkbench: () => navigate(WORKBENCH_PATH)");
  });

  it("底栏条目保留 path 供高亮（action 仍优先）", () => {
    const start = navRegistrySrc.indexOf('id: "workbench"');
    expect(start).toBeGreaterThan(0);
    const block = navRegistrySrc.slice(start, start + 400);
    expect(block).toContain("path: WORKBENCH_PATH");
    expect(block).toContain('action: "openWorkbench"');
  });
});

describe("目录页：搜索 / 最近使用 / 分组收起", () => {
  it("有搜索输入，且走 i18n", () => {
    expect(directorySrc).toContain('type="search"');
    expect(directorySrc).toContain('t("workbench.searchPlaceholder")');
    expect(directorySrc).toContain('t("workbench.searchEmpty")');
  });

  it("有「最近使用」分区，且只存 id（标题以 navRegistry 为准）", () => {
    expect(directorySrc).toContain('t("workbench.recent")');
    expect(directorySrc).toContain("RECENT_STORAGE_KEY");
    expect(directorySrc).toContain("localStorage.setItem");
  });

  it("分组可收起（aria-expanded）并显示条目数", () => {
    expect(directorySrc).toContain("aria-expanded={open}");
    expect(directorySrc).toContain('t("workbench.itemCount"');
  });

  it("默认只展开第一组（避免一屏 30 项）", () => {
    expect(directorySrc).toContain("const first = groups[0]");
    expect(directorySrc).toContain("new Set<WorkbenchGroupId>(first ? [first.id] : [])");
  });
});
