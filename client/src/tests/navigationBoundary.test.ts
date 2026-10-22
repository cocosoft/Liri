/**
 * 导航面边界：一个页面只允许一个导航壳（2026-10-22「收边界」回归锁）
 *
 * **现场**：`/work` 原是一个"工作台标签壳"，用 9 个标签复用 `HomePage / ProjectsPage /
 * DashboardPage / AgentPage / CouncilAgentRolesPage / SemanticIndexPage / UsageCenterPage`
 * —— 与 `navRegistry` 的工作台目录**指向同一批页面组件**；其中 `rules` 标签只是设置页
 * `CustomRulesPanel` 的适配器，`/plans` `/semantic` 两条路由更是早已重定向到 `/tasks` `/knowledge`。
 * ⇒ 两套工作面并存，且没有任何导航入口指向 `/work`（只有聊天工具块 `navigate("/work")`）。
 *
 * 本用例锁四件事：
 *  ① `/work` 只渲染工作项页（不再是标签壳），标签状态 store 已删除；
 *  ② 工作项能力没有丢（新建 / 进入规划仍在同一页）；
 *  ③ 设置侧保留「相关入口」交叉链接（同域两门：改配置 ↔ 管资源）；
 *  ④ 工作台条目不得借用 `settings.*` 命名（由 workbenchGroups.test.ts 另锁）。
 *
 * 手法：源码扫描（同 `Sidebar/__tests__/systemItemsOverride.test.ts` 的既有做法）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  NAV_ENTRIES,
  toEnabledModuleIds,
  workbenchGroups,
} from "../config/navRegistry";

const read = (rel: string): string =>
  readFileSync(resolve(__dirname, rel), "utf-8");

const routesSrc = read("../routes/index.tsx");
const workStoreSrc = read("../stores/workStore.ts");
const settingsSrc = read("../components/views/SettingsPage.tsx");
const workItemsSrc = read("../components/Workspace/WorkItemsPage.tsx");
const headerSrc = read("../components/common/Header.tsx");

/** 全模块可见下的工作台条目（用于断言"孤岛页已补入口"） */
const allModules = NAV_ENTRIES.filter((entry) => entry.moduleId).map(
  (entry) => ({ id: entry.moduleId as string }),
);
const allPaths = workbenchGroups(toEnabledModuleIds(allModules))
  .flatMap((group) => group.items)
  .map((item) => item.path);

describe("/work 不再是第二个工作台", () => {
  it("路由指向工作项页，且不再引用 WorkbenchPage", () => {
    expect(routesSrc).toContain("components/Workspace/WorkItemsPage");
    expect(routesSrc).not.toContain("components/workbench/WorkbenchPage");
    expect(routesSrc).toContain('path: "/work"');
  });

  it("视图标签状态已删除（不再导出 useWorkStore / CONTENT_VIEWS）", () => {
    expect(workStoreSrc).not.toContain("export const useWorkStore");
    expect(workStoreSrc).not.toContain("export const CONTENT_VIEWS");
    // 类型仍需保留：其它模块（workspaceStore / workspaceSlice / workspaceService）引用它们
    expect(workStoreSrc).toContain("export type WorkItemStatus");
    expect(workStoreSrc).toContain("export interface WorkItem");
  });

  it("工作项能力没有丢：新建 / 进入规划 / 列表删除仍在同一页", () => {
    expect(workItemsSrc).toContain('t("workspace.newWorkItem")');
    expect(workItemsSrc).toContain('t("workspace.enterPlanning")');
    expect(workItemsSrc).toContain("deleteWorkItem");
    expect(workItemsSrc).toContain("handleEnterPlanning");
  });
});

describe("设置侧「相关入口」交叉链接", () => {
  it("存在统一映射表，且覆盖模型 / 语音 / 权限 / 用户 / 办公", () => {
    expect(settingsSrc).toContain("CROSS_LINK_ENTRIES");
    for (const path of [
      '"/models"',
      '"/voice-stt"',
      '"/permissions"',
      '"/user"',
      '"/office"',
    ]) {
      expect(settingsSrc).toContain(path);
    }
  });

  it("点击链接会先收起设置抽屉再跳转（避免抽屉盖住目标页）", () => {
    expect(settingsSrc).toContain("closePanel()");
    expect(settingsSrc).toContain("navigate(link.path)");
    expect(settingsSrc).toContain('t("settings.relatedEntry")');
  });
});

describe("孤岛页面必须可达（前端充分暴露后端能力）", () => {
  it("/tts 与 /image 已纳入工作台目录（此前零入口 / 仅聊天结果卡）", () => {
    expect(allPaths).toContain("/tts");
    expect(allPaths).toContain("/image");
  });

  it("帮助中心在顶栏常驻（不再只藏在默认收起的「个人」组里）", () => {
    expect(headerSrc).toContain('navigate("/help")');
    expect(headerSrc).toContain("header.helpCenter");
  });
});
