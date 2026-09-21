/**
 * 工作台视图注册表 —— `ContentView` → 视图组件 的唯一映射（V-9 接线）
 *
 * 类型为 `Record<ContentView, WorkbenchViewSpec>`：`ContentView` 每新增一个成员，
 * 此处**必须**同时给出组件，否则编译失败 —— 从类型层面封死 V-9 的根因
 * （"联合里声明了成员，却既无实现也无消费方"）。
 *
 * 视图组件一律复用既有页面的默认导出（CS01 归一化，不新建页面）。
 */

import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";
import type { ContentView } from "@/stores/workStore";

/** 单个视图的注册信息 */
export interface WorkbenchViewSpec {
  /** 标签 i18n key（复用 `workspace` 命名空间） */
  labelKey: string;
  /** 视图组件（懒加载，避免工作台首屏拉入全部页面） */
  component: LazyExoticComponent<ComponentType>;
}

/** 全部工作台视图（穷尽声明，见文件头约束） */
export const WORKBENCH_VIEWS: Record<ContentView, WorkbenchViewSpec> = {
  welcome: {
    labelKey: "workspace.welcome",
    component: lazy(() => import("../views/HomePage")),
  },
  project: {
    labelKey: "workspace.project",
    component: lazy(() => import("../views/ProjectsPage")),
  },
  overview: {
    labelKey: "workspace.overview",
    component: lazy(() => import("../views/DashboardPage")),
  },
  plan_schema: {
    labelKey: "workspace.planSchema",
    component: lazy(() => import("../views/PlansPage")),
  },
  agent: {
    labelKey: "workspace.agent",
    component: lazy(() => import("../views/AgentPage")),
  },
  council: {
    // T1：正名为「Agent 角色」（与 navRegistry 的 `wb-council` 同键，避免两处叫法不一致）
    labelKey: "workspace.agentRoles",
    component: lazy(() => import("../views/CouncilAgentRolesPage")),
  },
  intelligence: {
    labelKey: "workspace.intelligence",
    component: lazy(() => import("../views/SemanticIndexPage")),
  },
  rules: {
    labelKey: "workspace.rules",
    component: lazy(() => import("./WorkbenchRulesView")),
  },
  cost: {
    labelKey: "workspace.cost",
    component: lazy(() => import("../views/UsageCenterPage")),
  },
};

// 视图的展示顺序由 `@/stores/workStore` 的 `CONTENT_VIEWS` 统一提供（单一事实来源），
// 本文件只负责"成员 → 组件"的映射，不再自带一份顺序表（2026-09-14 归一化）。
