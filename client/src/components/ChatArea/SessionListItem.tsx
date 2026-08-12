/**
 * 会话列表项组件
 *
 * 从 SessionHistorySidebar 中提取，渲染单个会话条目的：
 * - 工作空间归属前缀、来源标签、标题、时间、轮次
 * - 编辑态（双击重命名）
 * - 删除按钮（hover 显示）
 * - 右键菜单触发
 */
import { useRef, useEffect } from "react";
import { createLogger } from "@/utils/logger";
import { formatRelativeTime } from "../../utils/format";
import { useRootStore } from "../../stores/root-store";
import { getModuleMeta } from "../../stores/root-store/moduleRegistry";

const logger = createLogger("components:chat:sessionListItem");

interface SessionListItemProps {
  session: {
    id: string;
    title: string;
    updatedAt: string;
    source?: string;
    roundCount?: number;
    messageCount: number;
    workspaceId?: string | null;
    moduleType?: string;
  };
  isActive: boolean;
  isEditing: boolean;
  editTitle: string;
  pinned: boolean;
  isDreamProcessed: boolean;
  getSourceLabel: (source?: string) => string;
  onSwitch: (id: string) => void;
  onDoubleClick: (id: string, title: string) => void;
  onEditTitleChange: (title: string) => void;
  onEditBlur: () => void;
  onEditKeyDown: (e: React.KeyboardEvent) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
}

function SessionListItem({
  session,
  isActive,
  isEditing,
  editTitle,
  pinned: _pinned,
  isDreamProcessed,
  getSourceLabel,
  onSwitch,
  onDoubleClick,
  onEditTitleChange,
  onEditBlur,
  onEditKeyDown,
  onDelete,
  onContextMenu,
}: SessionListItemProps) {
  // 工作空间归属信息（用于显示归属前缀）
  const worktrees = useRootStore((s) => s.worktrees);
  const workspaceName = session.workspaceId
    ? worktrees[session.workspaceId]?.name
    : null;
  const moduleMeta = session.moduleType
    ? getModuleMeta(session.moduleType)
    : null;

  // R4 修复：单击延迟 250ms 执行切换，双击时第一次点击被取消——
  // 原 onClick + onDoubleClick 并存，双击先触发 2 次切换再重命名
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingClickIdRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
    },
    [],
  );

  const handleItemClick = (id: string) => {
    if (pendingClickIdRef.current !== null) {
      clearTimeout(clickTimerRef.current!);
      clickTimerRef.current = null;
      const prevId = pendingClickIdRef.current;
      pendingClickIdRef.current = null;
      if (prevId === id) {
        // 同一会话双击：取消单击切换，交给 onDoubleClick（重命名）
        // 竞态排查：双击取消切换——若单击切换仍发生，说明 250ms 窗口被突破
        logger.info("sessionListItem:clickCancelledByDblClick", {
          sessionId: id,
          dblClickWindowMs: 250,
        });
        return;
      }
      // 不同会话连点：先执行上一个待定切换，避免丢切换
      // 竞态排查：连点不同会话——记录先后顺序与切换次序
      logger.info("sessionListItem:rapidClickDifferentSession", {
        firstId: prevId,
        secondId: id,
      });
      onSwitch(prevId);
    }
    pendingClickIdRef.current = id;
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      pendingClickIdRef.current = null;
      logger.info("sessionListItem:switch", { sessionId: id });
      onSwitch(id);
    }, 250);
  };

  return (
    <div
      key={session.id}
      onContextMenu={(e) => onContextMenu(e, session.id)}
      className={`relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors group ${
        isActive
          ? "bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400"
          : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"
      }`}
    >
      <button
        onClick={() => handleItemClick(session.id)}
        onDoubleClick={() => onDoubleClick(session.id, session.title)}
        className="flex-1 flex items-center gap-2 truncate text-left min-w-0"
      >
        {isEditing ? (
          <input
            type="text"
            id={`session-title-edit-${session.id}`}
            value={editTitle}
            onChange={(e) => onEditTitleChange(e.target.value)}
            onBlur={onEditBlur}
            onKeyDown={onEditKeyDown}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-gray-700 border border-blue-300 dark:border-blue-600 rounded px-1 py-0.5 text-sm w-full outline-none"
          />
        ) : (
          <div className="flex-1 min-w-0">
            <div className="truncate flex items-center gap-1">
              {isDreamProcessed && (
                <span
                  className="inline-block w-2 h-2 rounded-full bg-green-400 dark:bg-green-500 flex-shrink-0"
                  title="已被梦境凝练"
                />
              )}
              {/* 工作空间归属前缀 */}
              {(workspaceName || moduleMeta) && (
                <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0 mr-0.5">
                  {moduleMeta?.emoji}
                  {workspaceName ?? moduleMeta?.label}
                  <span className="mx-0.5 opacity-50">/</span>
                </span>
              )}
              {session.title || "未命名会话"}
            </div>
            <div className="text-xs text-gray-400 dark:text-gray-500 truncate">
              {session.source ? (
                <span className="font-medium text-gray-400 dark:text-gray-500 mr-1">
                  {getSourceLabel(session.source)}
                </span>
              ) : null}
              {formatRelativeTime(session.updatedAt)}
              {(session.roundCount ?? Math.ceil(session.messageCount / 2)) >
                0 &&
                ` · ${session.roundCount ?? Math.ceil(session.messageCount / 2)} 轮对话`}
            </div>
          </div>
        )}
      </button>
      {!isEditing && (
        <button
          onClick={(e) => onDelete(e, session.id)}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:text-red-500 dark:hover:text-red-400 flex-shrink-0"
          title="删除会话"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      )}
    </div>
  );
}

export default SessionListItem;
