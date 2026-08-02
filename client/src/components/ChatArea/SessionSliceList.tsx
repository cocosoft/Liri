/**
 * SessionSliceList — SessionHub 会话列表组件
 *
 * Phase 4：增强为带模块类型筛选的完整会话列表。
 * 展示当前 worktree 下的所有模块 session，支持按模块类型筛选和切换。
 *
 * 使用方式：<SessionSliceList />
 */
import { useState, useMemo } from "react";
import { useRootStore } from "@/stores/root-store";
import { useNavigationStore } from "@/stores/navigationStore";
import {
  getModuleMeta,
  MODULE_TYPES,
} from "@/stores/root-store/moduleRegistry";
import { resolveWorktreeId } from "@/stores/root-store/moduleContextSlice";
import { createLogger } from "@/utils/logger";

const logger = createLogger("SessionSliceList");

/** 模块类型 → 导航路径映射（session 切换时跳转） */
const MODULE_PATH: Record<string, string> = {
  chat: "/chat",
  media: "/media",
  office: "/office",
  calendar: "/calendar",
  translation: "/translate",
  knowledge: "/knowledge",
};

export interface SessionSliceListProps {
  /** 最大显示数量（默认 100，基本等于全部） */
  maxItems?: number;
}

/**
 * SessionHub 会话列表（带模块类型筛选）
 *
 * 展示当前 worktree 下的所有模块 session。
 * Phase 4：增强为支持按模块类型筛选的主要会话列表。
 */
export function SessionSliceList({
  maxItems = 100,
}: SessionSliceListProps): React.ReactElement | null {
  const moduleContext = useRootStore((s) => s.moduleContext);
  const contextReady = useRootStore((s) => s._contextReady);
  const allSessions = useRootStore((s) => s.sessions);
  const currentSessionId = useRootStore((s) => s.currentSessionId);
  const switchSession = useRootStore((s) => s.switchSession);

  // 从 moduleContext 派生当前 worktree 作用域（替代直接读 currentWorktreeId）
  const scopeWorktreeId = useMemo(
    () => resolveWorktreeId(moduleContext.moduleType, moduleContext.projectId),
    [moduleContext.moduleType, moduleContext.projectId],
  );

  // 模块类型筛选状态：默认显示全部
  const [filterModule, setFilterModule] = useState<string>("all");

  // 派生当前 worktree 下的 session 列表
  const sessions = useMemo(() => {
    if (!scopeWorktreeId) return [];
    return Object.values(allSessions).filter(
      (s) => s.worktreeId === scopeWorktreeId,
    );
  }, [allSessions, scopeWorktreeId]);

  // 按模块类型筛选
  const filteredSessions = useMemo(() => {
    if (filterModule === "all") return sessions;
    return sessions.filter((s) => s.moduleType === filterModule);
  }, [sessions, filterModule]);

  // 统计各模块类型数量（用于 tab 徽标）
  const moduleCounts = useMemo(() => {
    const counts: Record<string, number> = { all: sessions.length };
    for (const s of sessions) {
      counts[s.moduleType] = (counts[s.moduleType] ?? 0) + 1;
    }
    return counts;
  }, [sessions]);

  /** 可用的模块类型列表（只显示有会话的模块） */
  const availableModuleTypes = useMemo(() => {
    return ["all", ...MODULE_TYPES.filter((t) => moduleCounts[t] > 0)];
  }, [moduleCounts]);

  // 等待 context 就绪（rehydrate 完成后才渲染，避免闪烁旧数据）
  if (!contextReady || !scopeWorktreeId || sessions.length === 0) {
    return null;
  }

  const displaySessions = filteredSessions.slice(0, maxItems);

  /** 会话列表项点击：切换 session + 导航到对应模块页面 */
  const handleClick = (sessionId: string, moduleType: string) => {
    switchSession(sessionId);
    // 导航到对应模块页面
    const path = MODULE_PATH[moduleType];
    if (path) {
      useNavigationStore.getState()._navigate?.(path);
    }
    logger.debug("SessionHub 会话切换", { sessionId, moduleType });
  };

  return (
    <div className="flex flex-col h-full">
      {/* 模块类型筛选标签 */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 overflow-x-auto scrollbar-none">
        {availableModuleTypes.map((type) => {
          const meta = getModuleMeta(type);
          const count = moduleCounts[type] ?? 0;
          const isActive = filterModule === type;

          return (
            <button
              key={type}
              onClick={() => setFilterModule(type)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs whitespace-nowrap transition-colors ${
                isActive
                  ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium"
                  : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700/50"
              }`}
              title={type === "all" ? "全部模块" : (meta?.label ?? type)}
            >
              {type === "all" ? (
                <>全部</>
              ) : (
                <>
                  <span className="text-xs leading-none">{meta?.emoji}</span>
                  <span>{meta?.label}</span>
                </>
              )}
              {count > 0 && (
                <span
                  className={`text-[10px] ml-0.5 ${isActive ? "text-blue-500" : "text-gray-400"}`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 会话列表 */}
      <div className="flex-1 overflow-y-auto">
        {displaySessions.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-gray-400 dark:text-gray-500">
            {filterModule === "all"
              ? "暂无会话"
              : `暂无${getModuleMeta(filterModule).label}会话`}
          </div>
        ) : (
          displaySessions.map((s) => {
            const isActive = s.id === currentSessionId;
            const meta = getModuleMeta(s.moduleType);

            return (
              <button
                key={s.id}
                onClick={() => handleClick(s.id, s.moduleType)}
                className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 border-b border-gray-50 dark:border-gray-800/50 ${
                  isActive
                    ? "bg-blue-50 dark:bg-blue-900/25 text-blue-700 dark:text-blue-300"
                    : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
                title={s.title}
              >
                {/* 模块图标 */}
                <span className="text-sm leading-none flex-shrink-0">
                  {meta?.emoji ?? "📌"}
                </span>

                {/* 标题 + 时间 */}
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm font-medium">
                    {s.title || "未命名会话"}
                  </div>
                  <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                    {meta?.label ?? s.moduleType}
                    {" · "}
                    {formatRelativeTime(s.updatedAt)}
                  </div>
                </div>

                {/* 活跃指示器 */}
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                )}
              </button>
            );
          })
        )}
      </div>

      {/* 底部统计 */}
      <div className="px-3 py-1.5 border-t border-gray-200 dark:border-gray-700 text-[10px] text-gray-400 dark:text-gray-500">
        {filterModule === "all"
          ? `共 ${sessions.length} 个会话`
          : `${getModuleMeta(filterModule).label} · ${filteredSessions.length} 个会话`}
      </div>
    </div>
  );
}

/**
 * 格式化相对时间显示
 * @param timestamp Unix 时间戳（毫秒）
 */
function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return "";

  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;

  const date = new Date(timestamp);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}/${day}`;
}

export default SessionSliceList;
