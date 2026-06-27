import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useSessionStore } from "../../stores/sessionStore";
import ConfirmDialog from "../common/ConfirmDialog";
import SessionContextMenu from "./SessionContextMenu";
import SessionListItem from "./SessionListItem";

/**
 * 会话来源渠道 → 显示名称映射
 * 根据会话的 source 字段显示来源标签，如【QQ】【WeChat】
 */
const SESSION_SOURCE_LABELS: Record<string, string> = {
  web:       'Web',
  qq:        'QQ',
  discord:   'Discord',
  telegram:  'Telegram',
  wechat:    'WeChat',
  wecom:     '企微',
  feishu:    '飞书',
  dingtalk:  '钉钉',
  slack:     'Slack',
  mcp:       'MCP',
  api:       'API',
  cli:       'CLI',
  irc:       'IRC',
  nostr:     'Nostr',
};

/**
 * 根据会话 source 获取来源显示标签
 * @returns 如 "【QQ】" 格式的标签文字，无 source 时返回空字符串
 */
function getSourceLabel(source?: string): string {
  if (!source) return '';
  const label = SESSION_SOURCE_LABELS[source];
  return label ? `【${label}】` : '';
}

/**
 * 会话历史侧边栏组件
 * 位于聊天界面左侧，展示当前用户的所有会话记录。
 * 支持新建、切换、重命名、删除会话，可折叠/展开。
 */
function SessionHistorySidebar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    sessions,
    currentSession,
    loadSessions,
    createSession,
    switchSession,
    deleteSession,
    clearAllSessions,
    togglePin,
    pinnedSessionIds,
  } = useSessionStore();

  // 从 localStorage 恢复折叠状态，默认展开
  const [isExpanded, setIsExpanded] = useState(() => {
    const saved = localStorage.getItem("sidebar_expanded");
    return saved !== null ? saved === "true" : true;
  });

  // 折叠状态变更时持久化
  const toggleSidebar = useCallback(() => {
    setIsExpanded((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar_expanded", String(next));
      return next;
    });
  }, []);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // 窄屏（< 1024px）自动折叠侧栏（不覆盖用户手动设置）
  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) {
        setIsExpanded(false);
        localStorage.setItem("sidebar_expanded", "false");
      }
    };
    handleChange(mediaQuery);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);
  // 确认对话框状态
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  // 虚拟列表状态
  const listContainerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const ESTIMATED_ITEM_HEIGHT = 56;
  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    sessionId: string;
  } | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, sessionId: string) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, sessionId });
    },
    [],
  );

  // 点击外部关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;
    const handleClickOutside = () => setContextMenu(null);
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [contextMenu]);

  // 右键菜单操作
  const handleRenameFromMenu = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (session) {
      setEditTitle(session.title);
      setEditingId(sessionId);
    }
    setContextMenu(null);
  };

  const handleCopyIdFromMenu = (sessionId: string) => {
    navigator.clipboard.writeText(sessionId);
    setContextMenu(null);
  };

  const handleExportSession = async (sessionId: string, format: "json" | "md") => {
    try {
      const session = sessions.find((s) => s.id === sessionId);
      if (!session) return;
      const data = JSON.stringify(session, null, 2);
      const blob = new Blob([data], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${session.title || "session"}.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setContextMenu(null);
    }
  };

  const handlePinSession = (sessionId: string) => {
    togglePin(sessionId);
    setContextMenu(null);
  };

  const isPinned = (sessionId: string): boolean => {
    return pinnedSessionIds.includes(sessionId);
  };

  const handleScroll = useCallback(() => {
    if (listContainerRef.current) {
      setScrollTop(listContainerRef.current.scrollTop);
    }
  }, []);

  // 搜索防抖：300ms 去抖
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const filteredSessions = useMemo(() => {
    let result = sessions;

    if (debouncedQuery.trim()) {
      const lower = debouncedQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.title.toLowerCase().includes(lower) ||
          s.id.toLowerCase().includes(lower),
      );
    }
    // 固定会话优先
    if (pinnedSessionIds.length > 0) {
      const pinnedSet = new Set(pinnedSessionIds);
      const pinnedItems = result.filter((s) => pinnedSet.has(s.id));
      const normalItems = result.filter((s) => !pinnedSet.has(s.id));
      return [...pinnedItems, ...normalItems];
    }
    return result;
  }, [sessions, debouncedQuery, pinnedSessionIds]);

  // 虚拟列表计算：仅渲染可见区域 + overscan
  const virtualList = useMemo(() => {
    const total = filteredSessions.length;
    const viewportHeight = listContainerRef.current?.clientHeight || 400;
    const overscan = 5;
    const startIdx = Math.max(0, Math.floor(scrollTop / ESTIMATED_ITEM_HEIGHT) - overscan);
    const endIdx = Math.min(
      total,
      Math.ceil((scrollTop + viewportHeight) / ESTIMATED_ITEM_HEIGHT) + overscan,
    );
    return {
      total,
      visibleItems: filteredSessions.slice(startIdx, endIdx),
      offsetY: startIdx * ESTIMATED_ITEM_HEIGHT,
      startIdx,
    };
  }, [filteredSessions, scrollTop]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const handleNewSession = async () => {
    const title = t('chat.newSession') + ` ${sessions.length + 1}`;
    await createSession(title);
    navigate("/chat");
  };

  const handleSwitchSession = (id: string) => {
    switchSession(id);
    navigate("/chat");
  };

  const handleDeleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteTarget(id);
  };

  const handleConfirmDelete = () => {
    if (deleteTarget) {
      deleteSession(deleteTarget);
      setDeleteTarget(null);
    }
  };

  const handleCancelDelete = () => {
    setDeleteTarget(null);
  };

  const handleDoubleClick = (id: string, title: string) => {
    setEditingId(id);
    setEditTitle(title);
  };

  const handleRenameBlur = () => {
    if (editingId && editTitle.trim()) {
      const store = useSessionStore.getState();
      const session = store.sessions.find((s) => s.id === editingId);
      if (session && editTitle.trim() !== session.title) {
        store.renameSession(editingId, editTitle.trim());
      }
    }
    setEditingId(null);
    setEditTitle("");
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRenameBlur();
    } else if (e.key === "Escape") {
      setEditingId(null);
      setEditTitle("");
    }
  };

  const handleClearAll = () => {
    setShowClearConfirm(true);
  };

  const handleConfirmClearAll = () => {
    clearAllSessions();
    setShowClearConfirm(false);
  };

  const handleCancelClearAll = () => {
    setShowClearConfirm(false);
  };

  if (!isExpanded) {
    return (
      <div className="group bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 transition-all duration-300 flex flex-col w-12 hover:w-60">
        <div className="p-2 border-b border-gray-200 dark:border-gray-700 flex justify-center group-hover:justify-between group-hover:px-3">
          <button
            onClick={toggleSidebar}
            className="p-1 text-gray-400 hover:text-blue-500 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            title={t('chat.expandSidebar')}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
          </button>
          <span className="hidden group-hover:inline text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('chat.sessionHistory')}
          </span>
        </div>
        <div className="flex-1 flex flex-col items-center py-2 gap-2 group-hover:hidden">
          <svg
            className="w-5 h-5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
            />
          </svg>
          {sessions.length > 0 && (
            <span className="text-xs text-gray-400">{sessions.length}</span>
          )}
        </div>
        <div className="hidden group-hover:flex flex-1 flex-col overflow-y-auto p-2">
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-4">
            {t('chat.allSessions')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700 transition-all duration-300 flex flex-col w-60">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t('chat.sessionHistory')}
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewSession}
            className="p-1 text-gray-400 hover:text-blue-500 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            title={t('chat.newSession')}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
          <button
            onClick={toggleSidebar}
            className="p-1 text-gray-400 hover:text-blue-500 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
            title={t('chat.collapseSidebar')}
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* 搜索框 */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('chat.searchSessions')}
          className="w-full px-2 py-1 text-xs bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-700 dark:text-gray-200 placeholder-gray-400"
        />
      </div>

      <div ref={listContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-2">
        {sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <svg className="w-10 h-10 text-gray-300 dark:text-gray-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <p className="text-sm text-gray-400 dark:text-gray-500">{t('chat.noSessions')}</p>
            <p className="text-xs text-gray-300 dark:text-gray-600 mt-1">{t('chat.createSessionHint')}</p>
          </div>
        ) : filteredSessions.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">{t('chat.noResults')}</p>
        ) : (
          <div style={{ height: virtualList.total * ESTIMATED_ITEM_HEIGHT, position: "relative" }}>
            <div style={{ transform: `translateY(${virtualList.offsetY}px)` }}>
              {virtualList.visibleItems.map((session) => (
                <SessionListItem
                  key={session.id}
                  session={session}
                  isActive={currentSession?.id === session.id}
                  isEditing={editingId === session.id}
                  editTitle={editTitle}
                  pinned={isPinned(session.id)}
                  getSourceLabel={getSourceLabel}
                  onSwitch={handleSwitchSession}
                  onDoubleClick={handleDoubleClick}
                  onEditTitleChange={setEditTitle}
                  onEditBlur={handleRenameBlur}
                  onEditKeyDown={handleRenameKeyDown}
                  onDelete={handleDeleteSession}
                  onContextMenu={handleContextMenu}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {sessions.length > 0 && (
        <div className="p-2 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleClearAll}
            className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
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
            {t('chat.clearHistory')}
          </button>
        </div>
      )}

      {/* 删除会话确认对话框 */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('chat.deleteSession')}
        message={t('chat.confirmDeleteSession', { title: sessions.find((s) => s.id === deleteTarget)?.title || t('chat.unnamedSession') })}
        confirmText={t('common.delete')}
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />

      {/* 清除全部确认对话框 */}
      <ConfirmDialog
        open={showClearConfirm}
        title={t('chat.clearAllTitle')}
        message={t('chat.clearAllMessage')}
        confirmText={t('chat.clearAll')}
        variant="danger"
        onConfirm={handleConfirmClearAll}
        onCancel={handleCancelClearAll}
      />

      {/* 右键上下文菜单 */}
      {contextMenu && (
        <SessionContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          sessionId={contextMenu.sessionId}
          isPinned={isPinned(contextMenu.sessionId)}
          onRename={handleRenameFromMenu}
          onCopyId={handleCopyIdFromMenu}
          onExport={handleExportSession}
          onTogglePin={handlePinSession}
        />
      )}
    </div>
  );
}

export default SessionHistorySidebar;
