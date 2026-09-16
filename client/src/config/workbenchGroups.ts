/**
 * 工作台四组导航数据（单一事实来源）
 *
 * 附录 F.3：设置页搬出的非高频功能按域归组（自主任务 / 平台治理 / 可观测 / 个人）。
 * 每项均为独立路由页面——点击跳转，不再在设置页内嵌渲染。
 * 路由均在 routes/index.tsx 核验存在（/estop 无独立路由，保留在设置页）。
 *
 * 2026-09-14 归一化：定义由 `components/Sidebar/Sidebar.tsx` 迁出，改为
 * `components/workbench/WorkbenchDirectoryPage.tsx`（独立页面）与 Sidebar 共用同一份数据，
 * 避免两处各写一份（此前只有侧栏内联展开与移动端抽屉两处渲染，已是同一份；本次仅换位置）。
 */

import type { ComponentType } from "react";
import {
  BookOpenIcon,
  BuddyIcon,
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
  KeyIcon,
  LinkIcon,
  McpIcon,
  MicIcon,
  ModelIcon,
  PluginIcon,
  ShieldIcon,
  SkillIcon,
  SlidersIcon,
  UsersIcon,
  WaveformIcon,
  ZapIcon,
} from "@/assets/icons";

/** 组内导航项（每项均有 labelKey 与 path） */
export interface WorkbenchNavItem {
  id: string;
  label: string;
  icon: ComponentType<{ className?: string; size?: number }>;
  labelKey: string;
  path: string;
}

/** 工作台分组 */
export interface WorkbenchGroup {
  id: string;
  labelKey: string;
  items: WorkbenchNavItem[];
}

export const WORKBENCH_GROUPS: WorkbenchGroup[] = [
  {
    id: "autonomy",
    labelKey: "workbench.groupAutonomy",
    items: [
      {
        id: "wb-agent",
        label: "Agent",
        icon: UsersIcon,
        labelKey: "nav.agent",
        path: "/agent",
      },
      {
        id: "wb-council",
        label: "委员会",
        icon: CouncilIcon,
        // 2026-09-14 修正：原 labelKey 为 `agent.title`，与上一项 `nav.agent` 同为
        // "Agent 管理" → 工作台出现两张同名卡片（预存缺陷，浏览器实测发现）。
        // 改用 `workspace.council`（与工作区页对同一 CouncilAgentRolesPage 的标签一致）。
        labelKey: "workspace.council",
        path: "/agent/roles",
      },
      {
        id: "wb-agent-advanced",
        label: "高级",
        icon: SlidersIcon,
        labelKey: "workbench.advanced",
        path: "/agent/advanced",
      },
      {
        id: "wb-cron",
        label: "定时",
        icon: CronIcon,
        labelKey: "nav.cron",
        path: "/cron",
      },
      {
        id: "wb-loops",
        label: "循环",
        icon: ZapIcon,
        labelKey: "workbench.loops",
        path: "/loops",
      },
      {
        id: "wb-bg",
        label: "后台",
        icon: CloudIcon,
        labelKey: "nav.backgroundStatus",
        path: "/background-status",
      },
      // DevPage 废弃后归入本组（原 /dev/autoreply 孤岛）
      {
        id: "wb-autoreply",
        label: "自动回复",
        icon: ChatIcon,
        labelKey: "workbench.autoreply",
        path: "/autoreply",
      },
    ],
  },
  {
    id: "governance",
    labelKey: "workbench.groupGovernance",
    items: [
      {
        id: "wb-models",
        label: "模型",
        icon: ModelIcon,
        labelKey: "model.title",
        path: "/models",
      },
      {
        id: "wb-skills",
        label: "技能",
        icon: SkillIcon,
        labelKey: "skill.title",
        path: "/skills",
      },
      {
        id: "wb-files",
        label: "文件",
        icon: FileIcon,
        labelKey: "nav.files",
        path: "/files",
      },
      {
        id: "wb-mcp",
        label: "MCP",
        icon: McpIcon,
        labelKey: "mcp.title",
        path: "/market/mcp",
      },
      {
        id: "wb-plugins",
        label: "插件",
        icon: PluginIcon,
        labelKey: "pluginMarket.title",
        path: "/market/plugins",
      },
      {
        id: "wb-channels",
        label: "频道",
        icon: ChannelIcon,
        labelKey: "channels.title",
        path: "/channels",
      },
      {
        id: "wb-permissions",
        label: "权限",
        icon: ShieldIcon,
        labelKey: "settings.permissions",
        path: "/permissions",
      },
      {
        id: "wb-apikeys",
        label: "密钥",
        icon: KeyIcon,
        labelKey: "settings.apiKeys",
        path: "/apikeys",
      },
      {
        id: "wb-oauth",
        label: "OAuth",
        icon: LinkIcon,
        labelKey: "settings.oauth",
        path: "/oauth",
      },
    ],
  },
  {
    id: "observability",
    labelKey: "workbench.groupObservability",
    items: [
      {
        id: "wb-dashboard",
        label: "仪表盘",
        icon: DashboardIcon,
        labelKey: "nav.dashboard",
        path: "/dashboard",
      },
      {
        id: "wb-usage",
        label: "用量",
        icon: DollarIcon,
        labelKey: "workbench.usage",
        path: "/usage?tab=cost",
      },
      {
        id: "wb-logs",
        label: "日志",
        icon: DocIcon,
        labelKey: "settings.logs",
        path: "/logs",
      },
      {
        id: "wb-sandbox",
        label: "沙箱",
        icon: DatabaseIcon,
        labelKey: "settings.sandbox",
        path: "/sandbox",
      },
      {
        id: "wb-security",
        label: "安全",
        icon: ShieldIcon,
        labelKey: "settings.securityOverview",
        path: "/security",
      },
      {
        id: "wb-terminal",
        label: "终端",
        icon: DevIcon,
        labelKey: "workbench.terminal",
        path: "/terminal",
      },
      // 全路由审计（G.2-14）：/voice-stt 原为孤岛，按用户决策补入口
      {
        id: "wb-voice-test",
        label: "语音测试",
        icon: MicIcon,
        labelKey: "workbench.voiceTest",
        path: "/voice-stt",
      },
    ],
  },
  {
    id: "personal",
    labelKey: "workbench.groupPersonal",
    items: [
      {
        id: "wb-user",
        label: "用户",
        icon: UsersIcon,
        labelKey: "header.userCenter",
        path: "/user",
      },
      {
        id: "wb-help",
        label: "帮助",
        icon: BookOpenIcon,
        labelKey: "header.helpCenter",
        path: "/help",
      },
      {
        id: "wb-liri",
        label: "人格",
        icon: BuddyIcon,
        labelKey: "workbench.liri",
        path: "/liri",
      },
      {
        id: "wb-dream",
        label: "梦境",
        icon: CloudIcon,
        labelKey: "workbench.dream",
        path: "/dream",
      },
      {
        id: "wb-buddy",
        label: "伙伴",
        icon: WaveformIcon,
        labelKey: "workbench.buddy",
        path: "/buddy",
      },
    ],
  },
];

/** 工作台入口路由（独立页面，取代原侧栏内联展开的抽屉） */
export const WORKBENCH_PATH = "/workbench";
