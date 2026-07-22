import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useWorkStore, type ContentView } from "../../stores/workStore";
import { useProjectStore } from "../../stores/projectStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { workspaceService } from "../../services/workspaceService";
import { WorkBoardView } from "./WorkBoardView";
import { TeamView } from "./TeamView";
import { CostView } from "./CostView";
import { WorkflowTemplateView } from "./WorkflowTemplateView";
import { CouncilView } from "./CouncilView";
import { OrchIntelligenceView } from "./OrchIntelligenceView";
import { RuleView } from "./RuleView";
import AgentCardGrid from "./AgentCardGrid";

interface WorkContentAreaProps {
  className?: string;
}

/** Tab 配置 */
interface TabConfig {
  key: ContentView;
  label: string;
  icon: string;
}

const TABS: TabConfig[] = [
  { key: "welcome", label: "工作区", icon: "\u{1F3AF}" },
  { key: "project", label: "项目", icon: "\u{1F4CA}" },
  { key: "editor", label: "编辑器", icon: "\u{1F527}" },
  { key: "council", label: "理事会", icon: "\u{1F3DB}\uFE0F" },
  { key: "intelligence", label: "智能", icon: "\u{1F9E0}" },
  { key: "rules", label: "规则", icon: "\u{1F4DC}" },
  { key: "team", label: "团队", icon: "\u{1F465}" },
  { key: "cost", label: "成本", icon: "\u{1F4B0}" },
  { key: "workflow_templates", label: "模板", icon: "\u{1F4CB}" },
  { key: "agent", label: "Agent", icon: "\u{1F916}" },
];

/**
 * Plan 模式下的内容区
 * 显示方案/架构图/分析结果（只读视图）
 */
function PlanContentArea() {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-3">{"\u{1F4CB}"}</div>
        <h3 className="text-base font-medium text-gray-700 dark:text-gray-300">
          {t("workspace.plan")}
        </h3>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
          {t("workspace.intelligence")}
        </p>
      </div>
    </div>
  );
}

/**
 * Do 模式下的内容区
 * 显示编辑器/diff/变更概览
 */
function DoContentArea() {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <div className="text-4xl mb-3">{"\u{1F527}"}</div>
        <h3 className="text-base font-medium text-gray-700 dark:text-gray-300">
          {t("workspace.do")}
        </h3>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
          {t("agent.status")}
        </p>
      </div>
    </div>
  );
}

/**
 * 根据 contentView 渲染对应的内容视图
 */
function ContentViewRenderer({ contentView }: { contentView: ContentView }) {
  const { t } = useTranslation();
  switch (contentView) {
    case "welcome":
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="text-5xl mb-4">{"\u{1F3AF}"}</div>
            <h2 className="text-lg font-semibold text-gray-700 dark:text-gray-300">
              {t("workspace.title")}
            </h2>
            <p className="text-sm text-gray-400 dark:text-gray-500 mt-2 max-w-md">
              {t("workspace.overview")}
            </p>
          </div>
        </div>
      );
    case "project":
      return <WorkBoardView projectId="default" />;
    case "team":
      return <TeamView />;
    case "cost":
      return <CostView />;
    case "workflow_templates":
      return <WorkflowTemplateView />;
    case "council":
      return <CouncilView />;
    case "intelligence":
      return <OrchIntelligenceView />;
    case "rules":
      return <RuleView />;
    case "agent":
      return <AgentCardGrid />;
    default:
      const mode = useWorkStore.getState().mode;
      return mode === "plan" ? <PlanContentArea /> : <DoContentArea />;
  }
}

/**
 * 面包屑导航
 * 显示当前所在位置的层级路径
 */
function BreadcrumbNav() {
  const contentView = useWorkStore((s) => s.contentView);
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);

  const pathParts = useMemo(() => {
    const parts: { label: string; icon?: string }[] = [
      { label: "工作台", icon: "\u{1F3E0}" },
    ];

    if (contentView === "project") {
      const project = activeProjectId ? projects[activeProjectId] : undefined;
      parts.push({ label: project?.name || "项目", icon: "\u{1F4CA}" });
    } else {
      const tab = TABS.find((t) => t.key === contentView);
      if (tab) parts.push({ label: tab.label, icon: tab.icon });
    }

    return parts;
  }, [contentView, projects, activeProjectId]);

  return (
    <nav className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900/50 border-b border-gray-100 dark:border-gray-800">
      {pathParts.map((part, idx) => (
        <span key={idx} className="flex items-center gap-1">
          {idx > 0 && (
            <span className="text-gray-300 dark:text-gray-600 mx-0.5">/</span>
          )}
          {part.icon && <span>{part.icon}</span>}
          <span
            className={
              idx === pathParts.length - 1
                ? "text-gray-600 dark:text-gray-300 font-medium"
                : ""
            }
          >
            {part.label}
          </span>
        </span>
      ))}
    </nav>
  );
}

/** 通知条目类型 */
interface NotificationItem {
  id: string;
  type: "info" | "success" | "warning" | "error";
  message: string;
  timestamp: number;
  read: boolean;
}

/**
 * 通知铃铛
 * 点击展开下拉菜单显示最近通知
 */
function NotificationBell() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  /** 点击外部关闭下拉 */
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  /** 标记全部已读 */
  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        title={t("workspace.title")}
      >
        <svg
          className="w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center w-3.5 h-3.5 text-[9px] font-bold text-white bg-red-500 rounded-full">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 max-h-80 overflow-hidden flex flex-col">
          {/* 头部 */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-700">
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
              {t("common.success")}
            </span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-blue-500 hover:text-blue-600"
              >
                {t("workspace.board")}
              </button>
            )}
          </div>

          {/* 列表 */}
          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-3 py-6 text-center text-xs text-gray-400">
                暂无通知
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`px-3 py-2 text-xs border-b border-gray-50 dark:border-gray-700/50 ${n.read ? "" : "bg-blue-50 dark:bg-blue-900/20"}`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        n.type === "success"
                          ? "bg-green-500"
                          : n.type === "warning"
                            ? "bg-amber-400"
                            : n.type === "error"
                              ? "bg-red-500"
                              : "bg-blue-400"
                      }`}
                    />
                    <span className="text-gray-600 dark:text-gray-400">
                      {n.message}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 工作内容区容器
 * 顶部 Tab 导航 + 面包屑 + 底部内容视图
 */
export default function WorkContentArea({ className }: WorkContentAreaProps) {
  const contentView = useWorkStore((s) => s.contentView);
  const setContentView = useWorkStore((s) => s.setContentView);
  const mode = useWorkStore((s) => s.mode);
  const workTabs = useWorkStore((s) => s.workTabs);
  const setWorkTabs = useWorkStore((s) => s.setWorkTabs);
  const currentWorkspace = useWorkspaceStore((s) => s.currentWorkspace);

  /** 从后端获取 Tab 可见性配置（挂载时 + workspace 切换时） */
  useEffect(() => {
    if (!currentWorkspace?.id) return;

    workspaceService
      .getConfig(currentWorkspace.id)
      .then((summary) => {
        const tabs = summary.config?.workTabs as string[] | undefined;
        setWorkTabs(Array.isArray(tabs) && tabs.length > 0 ? tabs : undefined);
        return undefined;
      })
      .catch(() => {
        // 获取失败不影响主流程，使用默认全部 Tab
        setWorkTabs(undefined);
      });
  }, [currentWorkspace?.id, setWorkTabs]);

  /** 过滤后的 Tab 列表 */
  const filteredTabs = useMemo(() => {
    if (!workTabs) return TABS;
    return TABS.filter((tab) => workTabs.includes(tab.key));
  }, [workTabs]);

  return (
    <div className={`${className} flex flex-col`}>
      {/* Tab 导航栏 */}
      <div className="flex items-center border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2">
        <div className="flex gap-1 py-1">
          {filteredTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setContentView(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                contentView === tab.key
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 font-medium"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-300 dark:hover:bg-gray-800"
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* 右侧：通知铃铛 + 模式指示 */}
        <div className="ml-auto flex items-center gap-1 pr-2">
          <NotificationBell />
          <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">
            {mode === "plan" ? "Plan" : "Do"}
          </span>
        </div>
      </div>

      {/* 面包屑 */}
      <BreadcrumbNav />

      {/* 内容视图 */}
      <div className="flex-1 overflow-hidden">
        <ContentViewRenderer contentView={contentView} />
      </div>
    </div>
  );
}
