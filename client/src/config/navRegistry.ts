/**
 * navRegistry — 导航入口元数据**单一事实来源**
 *
 * 背景（frontend-nav-optimization.md §4.3-6）：此前同一导航入口的元数据分散在 4 处
 * 字面量（Sidebar 高区 HIGH_FREQ_NAV、Sidebar 本地 WORKBENCH_GROUPS、config/workbenchGroups.ts、
 * HomePage 的 MODULE_CARD_META / TOOL_CARDS、MobileBottomNav items），已实测发生漂移
 * （如 wb-council 的兜底 label 一处「委员会」一处「理事会」；办公/媒体下沉需改两处）。
 *
 * 本文件收敛为唯一来源：条目只声明一次，并在 `surfaces` 中声明它出现在哪些导航面；
 * 各渲染面（桌面高区 / 工作台四组 / 首页卡片 / 移动端底栏）只做「过滤 + 排序 + 渲染」。
 *
 * 设计约束：
 * - **不提供 label 兜底字段**：展示文案唯一来源是 `labelKey`（i18n）。历史上正是兜底字符串
 *   承载了静默漂移；去掉后「无 i18n 即无文案」，由 typecheck（key 类型）与运行期 missing key 暴露。
 * - 模块可用性（enabled / tier）不在此重复定义，统一经 `moduleId` 引用
 *   `stores/root-store/moduleRegistry.ts`（配合 `selectEnabledModules`）。
 * - 排序键按**导航面**分别声明（`order[surface]`）：同一条目在不同面的顺序本就不同
 *   （如「项目」在高区在「对话」之后、在底栏在「对话」之前），单一全局序号无法同时满足。
 */

import type { ComponentType } from "react";
import {
  BookOpenIcon,
  BuddyIcon,
  BellIcon,
  ChannelIcon,
  ChatIcon,
  CloudIcon,
  CouncilIcon,
  CronIcon,
  DashboardIcon,
  DatabaseIcon,
  DevIcon,
  DocIcon,
  DollarIcon,
  FileIcon,
  HomeIcon,
  ImageIcon,
  KeyIcon,
  KnowledgeIcon,
  LinkIcon,
  McpIcon,
  MicIcon,
  ModelIcon,
  OfficeIcon,
  PluginIcon,
  ShieldIcon,
  SettingsIcon,
  SkillIcon,
  SlidersIcon,
  TaskIcon,
  UsersIcon,
  WaveformIcon,
  ZapIcon,
} from "@/assets/icons";

/** 导航面：同一入口可同时出现在多个面 */
export type NavSurface = "high" | "workbench" | "home" | "mobile";

/** 工作台分组 id（组顺序见 WORKBENCH_GROUPS_META） */
export type WorkbenchGroupId =
  "autonomy" | "governance" | "observability" | "personal";

/** 首页分区 id（区顺序见 HOME_SECTIONS_META） */
export type HomeSectionId = "module" | "tool";

/**
 * 动作型入口（无 page 语义，点击触发行为而非路由）。
 * 具体行为由消费侧（Sidebar）映射，注册表只承载"是什么动作"。
 */
export type NavActionKind =
  "openNotifications" | "openWorkbench" | "openSettings";

export interface NavEntry {
  /** 全局唯一 id */
  id: string;
  /** i18n key（唯一展示来源，不提供兜底文案） */
  labelKey: string;
  icon: ComponentType<{ className?: string; size?: number }>;
  /** 目标路由（页面型）；动作型可省略 */
  path?: string;
  /** 点击行为：存在时优先于 path 跳转（如设置→侧边面板）；path 仍用于 active 高亮 */
  action?: NavActionKind;
  /** 模块门控：存在时隐藏条件为"该模块未启用或当前 tier 不可见" */
  moduleId?: string;
  /** 出现在哪些导航面 */
  surfaces: NavSurface[];
  /** surfaces 含 "workbench" 时必填 */
  workbenchGroup?: WorkbenchGroupId;
  /** surfaces 含 "home" 时必填 */
  homeSection?: HomeSectionId;
  /** 各面内排序键（仅在同面同分区内比较） */
  order?: Partial<Record<NavSurface, number>>;
  /** 首页卡片副标题 i18n key */
  descKey?: string;
  /** 移动端底栏角标来源（当前仅未读通知数） */
  badge?: "unread";
  /** 未完全成熟的新能力：true 时渲染 Preview 角标 */
  preview?: boolean;
}

/** 工作台四组（顺序即渲染顺序） */
export const WORKBENCH_GROUPS_META: Array<{
  id: WorkbenchGroupId;
  labelKey: string;
}> = [
  { id: "autonomy", labelKey: "workbench.groupAutonomy" },
  { id: "governance", labelKey: "workbench.groupGovernance" },
  { id: "observability", labelKey: "workbench.groupObservability" },
  { id: "personal", labelKey: "workbench.groupPersonal" },
];

/** 首页两区（顺序即渲染顺序） */
export const HOME_SECTIONS_META: Array<{
  id: HomeSectionId;
  titleKey: string;
}> = [
  { id: "module", titleKey: "home.modulesTitle" },
  { id: "tool", titleKey: "home.toolsTitle" },
];

/** 工作台入口路由（独立页面） */
export const WORKBENCH_PATH = "/workbench";

/**
 * 全部导航条目（唯一事实来源）。
 *
 * order 说明：`high` / `home` / `mobile` / `workbench` 分别独立编号，仅在同面内比较；
 * 首页还需按 homeSection 分区后再排序。
 */
export const NAV_ENTRIES: NavEntry[] = [
  // ── 高区 + 首页（模块卡） ────────────────────────────────
  {
    id: "home",
    labelKey: "nav.home",
    icon: HomeIcon,
    path: "/",
    surfaces: ["high"],
    order: { high: 10 },
  },
  {
    id: "chat",
    labelKey: "nav.chat",
    icon: ChatIcon,
    path: "/chat",
    moduleId: "chat",
    surfaces: ["high", "home", "mobile"],
    homeSection: "module",
    descKey: "home.card.chatDesc",
    order: { high: 20, home: 10, mobile: 20 },
  },
  {
    id: "projects",
    labelKey: "nav.projects",
    icon: DashboardIcon,
    path: "/projects",
    moduleId: "project",
    surfaces: ["high", "home", "mobile"],
    homeSection: "module",
    descKey: "home.card.projectsDesc",
    order: { high: 30, home: 20, mobile: 10 },
  },
  {
    id: "tasks",
    labelKey: "nav.tasks",
    icon: TaskIcon,
    path: "/tasks",
    surfaces: ["high", "home"],
    homeSection: "tool",
    descKey: "home.card.tasksDesc",
    order: { high: 40, home: 10 },
  },
  {
    id: "knowledge",
    labelKey: "nav.knowledge",
    icon: KnowledgeIcon,
    path: "/knowledge",
    moduleId: "knowledge",
    surfaces: ["high", "home"],
    homeSection: "module",
    descKey: "home.card.knowledgeDesc",
    order: { high: 70, home: 50 },
  },

  // ── 工作台「自主任务」 + 首页 ────────────────────────────
  {
    id: "wb-agent",
    labelKey: "nav.agent",
    icon: UsersIcon,
    path: "/agent",
    surfaces: ["workbench"],
    workbenchGroup: "autonomy",
    order: { workbench: 10 },
  },
  {
    id: "wb-council",
    // T1：正名为「Agent 角色」（该页是全局 Agent 角色管理面，非仅理事会）
    labelKey: "workspace.agentRoles",
    icon: CouncilIcon,
    path: "/agent/roles",
    surfaces: ["workbench"],
    workbenchGroup: "autonomy",
    order: { workbench: 20 },
  },
  {
    id: "wb-agent-advanced",
    labelKey: "workbench.advanced",
    icon: SlidersIcon,
    path: "/agent/advanced",
    surfaces: ["workbench"],
    workbenchGroup: "autonomy",
    order: { workbench: 30 },
  },
  {
    id: "wb-cron",
    labelKey: "nav.cron",
    icon: CronIcon,
    path: "/cron",
    surfaces: ["workbench", "home"],
    workbenchGroup: "autonomy",
    homeSection: "tool",
    descKey: "home.card.cronDesc",
    order: { workbench: 40, home: 20 },
  },
  {
    id: "wb-loops",
    labelKey: "workbench.loops",
    icon: ZapIcon,
    path: "/loops",
    surfaces: ["workbench"],
    workbenchGroup: "autonomy",
    order: { workbench: 50 },
  },
  {
    id: "wb-bg",
    labelKey: "nav.backgroundStatus",
    icon: CloudIcon,
    path: "/background-status",
    surfaces: ["workbench"],
    workbenchGroup: "autonomy",
    order: { workbench: 60 },
  },
  {
    id: "wb-autoreply",
    labelKey: "workbench.autoreply",
    icon: ChatIcon,
    path: "/autoreply",
    surfaces: ["workbench"],
    workbenchGroup: "autonomy",
    order: { workbench: 70 },
  },
  {
    // 4.1-1：办公/媒体自高区下沉到工作台（高区 7→5 项，对齐 Copilot）
    // §4.3-6：补 moduleId，使"模块禁用/tier 不可见"在首页与工作台两面一致
    //（此前工作台项无 moduleId，导致 base 版"首页看不到、工作台看得到"）
    id: "wb-office",
    labelKey: "nav.office",
    icon: OfficeIcon,
    path: "/office",
    moduleId: "office",
    surfaces: ["workbench", "home"],
    workbenchGroup: "autonomy",
    homeSection: "module",
    descKey: "home.card.officeDesc",
    order: { workbench: 80, home: 30 },
  },
  {
    id: "wb-media",
    labelKey: "nav.media",
    icon: ImageIcon,
    path: "/media",
    moduleId: "media",
    surfaces: ["workbench", "home"],
    workbenchGroup: "autonomy",
    homeSection: "module",
    descKey: "home.card.mediaDesc",
    order: { workbench: 90, home: 40 },
  },

  // ── 工作台「平台治理」 ──────────────────────────────────
  {
    id: "wb-models",
    labelKey: "model.title",
    icon: ModelIcon,
    path: "/models",
    surfaces: ["workbench"],
    workbenchGroup: "governance",
    order: { workbench: 110 },
  },
  {
    id: "wb-skills",
    labelKey: "skill.title",
    icon: SkillIcon,
    path: "/skills",
    surfaces: ["workbench"],
    workbenchGroup: "governance",
    order: { workbench: 120 },
  },
  {
    id: "wb-files",
    labelKey: "nav.files",
    icon: FileIcon,
    path: "/files",
    surfaces: ["workbench", "home"],
    workbenchGroup: "governance",
    homeSection: "tool",
    descKey: "home.card.filesDesc",
    order: { workbench: 130, home: 50 },
  },
  {
    id: "wb-mcp",
    labelKey: "mcp.title",
    icon: McpIcon,
    path: "/market/mcp",
    surfaces: ["workbench"],
    workbenchGroup: "governance",
    order: { workbench: 140 },
  },
  {
    id: "wb-plugins",
    labelKey: "pluginMarket.title",
    icon: PluginIcon,
    path: "/market/plugins",
    surfaces: ["workbench"],
    workbenchGroup: "governance",
    order: { workbench: 150 },
  },
  {
    id: "wb-channels",
    labelKey: "channels.title",
    icon: ChannelIcon,
    path: "/channels",
    surfaces: ["workbench"],
    workbenchGroup: "governance",
    order: { workbench: 160 },
  },
  {
    id: "wb-permissions",
    labelKey: "settings.permissions",
    icon: ShieldIcon,
    path: "/permissions",
    surfaces: ["workbench"],
    workbenchGroup: "governance",
    order: { workbench: 170 },
  },
  {
    id: "wb-apikeys",
    labelKey: "settings.apiKeys",
    icon: KeyIcon,
    path: "/apikeys",
    surfaces: ["workbench"],
    workbenchGroup: "governance",
    order: { workbench: 180 },
  },
  {
    id: "wb-oauth",
    labelKey: "settings.oauth",
    icon: LinkIcon,
    path: "/oauth",
    surfaces: ["workbench"],
    workbenchGroup: "governance",
    order: { workbench: 190 },
  },

  // ── 工作台「可观测」 + 首页 ──────────────────────────────
  {
    id: "wb-dashboard",
    labelKey: "nav.dashboard",
    icon: DashboardIcon,
    path: "/dashboard",
    surfaces: ["workbench", "home"],
    workbenchGroup: "observability",
    homeSection: "tool",
    descKey: "home.card.dashboardDesc",
    order: { workbench: 210, home: 30 },
  },
  {
    id: "wb-usage",
    labelKey: "workbench.usage",
    icon: DollarIcon,
    path: "/usage?tab=cost",
    surfaces: ["workbench", "home"],
    workbenchGroup: "observability",
    homeSection: "tool",
    descKey: "home.card.costDesc",
    order: { workbench: 220, home: 40 },
  },
  {
    id: "wb-logs",
    labelKey: "settings.logs",
    icon: DocIcon,
    path: "/logs",
    surfaces: ["workbench"],
    workbenchGroup: "observability",
    order: { workbench: 230 },
  },
  {
    id: "wb-sandbox",
    labelKey: "settings.sandbox",
    icon: DatabaseIcon,
    path: "/sandbox",
    surfaces: ["workbench"],
    workbenchGroup: "observability",
    order: { workbench: 240 },
  },
  {
    id: "wb-security",
    labelKey: "settings.securityOverview",
    icon: ShieldIcon,
    path: "/security",
    surfaces: ["workbench"],
    workbenchGroup: "observability",
    order: { workbench: 250 },
  },
  {
    id: "wb-terminal",
    labelKey: "workbench.terminal",
    icon: DevIcon,
    path: "/terminal",
    surfaces: ["workbench", "home"],
    workbenchGroup: "observability",
    homeSection: "tool",
    descKey: "home.card.terminalDesc",
    order: { workbench: 260, home: 60 },
  },
  {
    // 全路由审计（G.2-14）：/voice-stt 原为孤岛，按用户决策补入口
    id: "wb-voice-test",
    labelKey: "workbench.voiceTest",
    icon: MicIcon,
    path: "/voice-stt",
    surfaces: ["workbench"],
    workbenchGroup: "observability",
    order: { workbench: 270 },
  },

  // ── 工作台「个人」 ──────────────────────────────────────
  {
    id: "wb-user",
    labelKey: "header.userCenter",
    icon: UsersIcon,
    path: "/user",
    surfaces: ["workbench"],
    workbenchGroup: "personal",
    order: { workbench: 310 },
  },
  {
    id: "wb-help",
    labelKey: "header.helpCenter",
    icon: BookOpenIcon,
    path: "/help",
    surfaces: ["workbench"],
    workbenchGroup: "personal",
    order: { workbench: 320 },
  },
  {
    id: "wb-liri",
    labelKey: "workbench.liri",
    icon: BuddyIcon,
    path: "/liri",
    surfaces: ["workbench"],
    workbenchGroup: "personal",
    order: { workbench: 330 },
  },
  {
    id: "wb-dream",
    labelKey: "workbench.dream",
    icon: CloudIcon,
    path: "/dream",
    surfaces: ["workbench"],
    workbenchGroup: "personal",
    order: { workbench: 340 },
  },
  {
    id: "wb-buddy",
    labelKey: "workbench.buddy",
    icon: WaveformIcon,
    path: "/buddy",
    surfaces: ["workbench"],
    workbenchGroup: "personal",
    order: { workbench: 350 },
  },

  // ── 首页「快捷工具」 + 移动端底栏 ────────────────────────
  {
    // A3：设置改为侧边抽屉打开（action 优先于 path 跳转；path 保留供 /settings 高亮）
    id: "settings",
    labelKey: "nav.settings",
    icon: SettingsIcon,
    path: "/settings",
    action: "openSettings",
    surfaces: ["home", "mobile"],
    homeSection: "tool",
    descKey: "home.card.settingsDesc",
    order: { home: 70, mobile: 50 },
  },

  // ── 移动端底栏（动作型） ────────────────────────────────
  {
    id: "notifications",
    labelKey: "header.notifications",
    icon: BellIcon,
    action: "openNotifications",
    surfaces: ["mobile"],
    badge: "unread",
    order: { mobile: 30 },
  },
  {
    id: "workbench",
    labelKey: "sidebar.workbench",
    icon: DashboardIcon,
    action: "openWorkbench",
    surfaces: ["mobile"],
    order: { mobile: 40 },
  },
];

/**
 * 某导航面的条目（已按该面 order 排序；未声明 order 视为 0，保持声明顺序）。
 *
 * ⚠️ **未做模块门控**，仅供本文件内部使用、不对外导出：所有对外派生函数
 * （`workbenchGroups` / `homeSections` / `mobileNavEntries` / `highFrequencyNavEntries`）
 * 都**强制接收**可见模块集合并于内部过门控，避免调用方遗漏。
 * （§4.3-6 曾因工作台派生漏门控，出现 base 档下首页隐藏「办公」而工作台仍显示。）
 */
function entriesForSurface(surface: NavSurface): NavEntry[] {
  return NAV_ENTRIES.filter((e) => e.surfaces.includes(surface)).sort(
    (a, b) => (a.order?.[surface] ?? 0) - (b.order?.[surface] ?? 0),
  );
}

/**
 * 模块门控（唯一实现）：无 `moduleId` 恒可见；有 `moduleId` 需该模块在当前 tier 下已启用。
 */
function filterByEnabledModules(
  entries: NavEntry[],
  enabledModuleIds: ReadonlySet<string>,
): NavEntry[] {
  return entries.filter((e) => !e.moduleId || enabledModuleIds.has(e.moduleId));
}

/** 由模块列表构造门控集合（避免各调用点各写 `new Set(...)`） */
export function toEnabledModuleIds(
  modules: ReadonlyArray<{ id: string }>,
): Set<string> {
  return new Set(modules.map((m) => m.id));
}

/** 工作台四组（组内按 order.workbench 排序；组顺序固定为 WORKBENCH_GROUPS_META） */
export function workbenchGroups(enabledModuleIds: ReadonlySet<string>): Array<{
  id: WorkbenchGroupId;
  labelKey: string;
  items: NavEntry[];
}> {
  const all = filterByEnabledModules(
    entriesForSurface("workbench"),
    enabledModuleIds,
  );
  return WORKBENCH_GROUPS_META.map((g) => ({
    id: g.id,
    labelKey: g.labelKey,
    items: all.filter((e) => e.workbenchGroup === g.id),
  }));
}

/** 首页两区（区内按 order.home 排序；区顺序固定为 HOME_SECTIONS_META） */
export function homeSections(enabledModuleIds: ReadonlySet<string>): Array<{
  id: HomeSectionId;
  titleKey: string;
  items: NavEntry[];
}> {
  const all = filterByEnabledModules(
    entriesForSurface("home"),
    enabledModuleIds,
  );
  return HOME_SECTIONS_META.map((s) => ({
    id: s.id,
    titleKey: s.titleKey,
    items: all.filter((e) => e.homeSection === s.id),
  }));
}

/** 移动端底栏条目（已过模块门控） */
export function mobileNavEntries(
  enabledModuleIds: ReadonlySet<string>,
): NavEntry[] {
  return filterByEnabledModules(entriesForSurface("mobile"), enabledModuleIds);
}

/** 桌面高区条目（已过模块门控） */
export function highFrequencyNavEntries(
  enabledModuleIds: ReadonlySet<string>,
): NavEntry[] {
  return filterByEnabledModules(entriesForSurface("high"), enabledModuleIds);
}
