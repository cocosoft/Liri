import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../../stores/sessionStore";
import { useRootStore } from "../../stores/root-store";
import { useNavigationStore } from "../../stores/navigationStore";
import type { AppPage } from "../../stores/navigationStore";
import { getModuleMeta } from "../../stores/root-store/moduleRegistry";
import { fileService } from "../../services/fileService";
import { knowledgeService } from "../../services/knowledgeService";
import { getOTelTracing } from "../../monitoring/otel/OTelTracing";
import { createLogger } from "@/utils/logger";

const logger = createLogger("GlobalSearchModal");
import { handleClientError } from "../../utils/handleError";
import type { Session } from "../../types";
import type { FileRegistryRecord } from "../../types/file";
import type { KnowledgeItem } from "../../types/knowledge";

interface GlobalSearchModalProps {
  /** 是否显示 */
  isOpen: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 是否为暗色主题（预留） */
  isDark?: boolean;
}

/**
 * GlobalSearchModal — 全局搜索弹窗
 *
 * 支持跨模块搜索：会话标题、文件名、知识库条目。
 * 快捷键：Ctrl+K / Cmd+K 唤起，Escape 关闭。
 * 搜索结果分组展示，点击会话/文件/知识库导航到对应页面。
 */
export default function GlobalSearchModal({
  isOpen,
  onClose,
  isDark: _isDark,
}: GlobalSearchModalProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [sessionResults, setSessionResults] = useState<Session[]>([]);
  const [fileResults, setFileResults] = useState<FileRegistryRecord[]>([]);
  const [knowledgeResults, setKnowledgeResults] = useState<KnowledgeItem[]>([]);
  const [searching, setSearching] = useState(false);
  // P1-10: 搜索源从 chatSessions 改为 SessionHub 全量（含 media/office 等模块会话）
  const sessionsRecord = useRootStore((s) => s.sessions);
  const worktrees = useRootStore((s) => s.worktrees);
  const allSessions = useMemo(
    () => Object.values(sessionsRecord),
    [sessionsRecord],
  );
  const switchWorktree = useRootStore((s) => s.switchWorktree);
  const switchSession = useSessionStore((s) => s.switchSession);
  const setActivePage = useNavigationStore((s) => s.setActivePage);

  /** 模块类型 → AppPage 映射 */
  const MODULE_PAGE: Record<string, AppPage> = {
    chat: "chat",
    knowledge: "knowledge",
    files: "files",
    workspace: "workspace",
  };

  /** 聚焦输入框 */
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSessionResults([]);
      setFileResults([]);
      setKnowledgeResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  /** 300ms 防抖搜索 */
  useEffect(() => {
    if (!query.trim()) {
      setSessionResults([]);
      setFileResults([]);
      setKnowledgeResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      const q = query.toLowerCase();

      // 1. 客户端过滤所有模块会话标题（SessionHub 全量）
      //    SessionRecord 有 title 字段，转为 Session-like 结构用于搜索
      const matchedSessions = allSessions
        .filter((s) => s.title?.toLowerCase().includes(q))
        .slice(0, 5);
      setSessionResults(
        matchedSessions.map(
          (s) =>
            ({
              id: s.id,
              title: s.title,
              createdAt: new Date(s.createdAt).toISOString(),
              updatedAt: new Date(s.updatedAt).toISOString(),
              messageCount: 0,
              roundCount: 0,
              // 携带归属信息
              workspaceId: s.worktreeId,
            }) as Session,
        ),
      );

      // 2. 异步搜索文件
      try {
        const fileRes = await fileService.searchFiles({ query: q, limit: 5 });
        setFileResults(fileRes.items.slice(0, 5));
      } catch (e) {
        handleClientError(e, {
          module: "components:chat:GlobalSearch",
          action: "searchFiles",
        });
        setFileResults([]);
      }

      // 3. 异步搜索知识库
      try {
        const kbRes = await knowledgeService.search(q);
        setKnowledgeResults((kbRes as KnowledgeItem[]).slice(0, 5));
      } catch (e) {
        handleClientError(e, {
          module: "components:chat:GlobalSearch",
          action: "searchKnowledge",
        });
        setKnowledgeResults([]);
      }

      setSearching(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, allSessions]);

  /** 点击会话结果：切换工作空间 + 会话 + 跳转正确模块页面 */
  const handleSessionClick = useCallback(
    async (session: Session) => {
      const otel = getOTelTracing();
      const span = otel.startSpan("session.switch.globalSearch", {
        sessionId: session.id,
        sessionTitle: session.title,
      });

      try {
        if (import.meta.env.DEV)
          console.info("[SessionSwitch] 全局搜索切换会话", {
            sessionId: session.id,
            sessionTitle: session.title,
            workspaceId: session.workspaceId,
            timestamp: Date.now(),
          });

        // P1-11: 先切换工作空间（如果有），再切换会话，再导航到正确模块
        if (session.workspaceId) {
          await switchWorktree(session.workspaceId);
        }
        await switchSession(session.id);
        // 根据 workspaceId 确定目标页面
        const page = MODULE_PAGE[session.workspaceId ?? "chat"] ?? "chat";

        if (import.meta.env.DEV)
          console.info("[SessionSwitch] 全局搜索切换会话成功", {
            sessionId: session.id,
            page,
            timestamp: Date.now(),
          });

        span.setAttribute("status", "success");
        setActivePage(page);
        onClose();
      } catch (error) {
        if (import.meta.env.DEV)
          logger.error("[SessionSwitch] 全局搜索切换会话失败", {
            sessionId: session.id,
            sessionTitle: session.title,
            error: String(error),
            stack: (error as Error)?.stack,
            timestamp: Date.now(),
          });

        span.setAttribute("status", "error");
        handleClientError(error, {
          module: "components:chat:GlobalSearchModal",
          action: "handleSessionClick",
          meta: { sessionId: session.id, sessionTitle: session.title },
        });
      } finally {
        otel.endSpan(span);
      }
    },
    [switchSession, switchWorktree, setActivePage, onClose],
  );

  /** 获取会话的归属显示信息 */
  const getSessionContext = (session: Session) => {
    if (session.workspaceId) {
      const ws = worktrees[session.workspaceId];
      if (ws) return { icon: "📁", name: ws.name, type: "workspace" };
    }
    // 默认为聊天模块
    return { icon: getModuleMeta("chat").emoji, name: "聊天", type: "module" };
  };

  /** 点击文件结果：跳转文件页面 */
  const handleFileClick = useCallback(() => {
    setActivePage("files");
    onClose();
  }, [setActivePage, onClose]);

  /** 点击知识库结果：跳转知识库页面 */
  const handleKnowledgeClick = useCallback(() => {
    setActivePage("knowledge");
    onClose();
  }, [setActivePage, onClose]);

  /** Escape 关闭 */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  if (!isOpen) return null;

  const hasResults =
    sessionResults.length > 0 ||
    fileResults.length > 0 ||
    knowledgeResults.length > 0;
  const noResults = !searching && query && !hasResults;

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* 搜索弹窗 */}
      <div className="fixed inset-x-0 top-[15%] z-50 mx-auto max-w-xl">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* 搜索输入 */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <svg
              className="w-5 h-5 text-gray-400 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              ref={inputRef}
              id="global-search-input"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("chat.globalSearchPlaceholder")}
              className="flex-1 text-base bg-transparent border-none outline-none text-gray-800 dark:text-gray-200 placeholder-gray-400"
            />
            {searching && (
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />
            )}
            <kbd className="hidden sm:inline-flex items-center px-2 py-0.5 text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 rounded font-mono">
              Esc
            </kbd>
          </div>

          {/* 搜索结果 */}
          <div className="max-h-80 overflow-y-auto">
            {noResults && (
              <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                {t("chat.noSearchResults")}
              </div>
            )}

            {/* 会话结果 */}
            {sessionResults.length > 0 && (
              <div>
                <div className="px-4 py-2 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                  {t("chat.sessions")}
                </div>
                {sessionResults.map((session) => {
                  const ctx = getSessionContext(session);
                  return (
                    <button
                      key={session.id}
                      onClick={() => handleSessionClick(session)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    >
                      <span className="text-base shrink-0">{ctx.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-gray-800 dark:text-gray-200 truncate">
                          <span className="text-[10px] text-gray-400 dark:text-gray-500 mr-1">
                            {ctx.name} /
                          </span>
                          {session.title || t("chat.untitledSession")}
                        </div>
                        <div className="text-xs text-gray-400 dark:text-gray-500">
                          {session.messageCount != null
                            ? `${session.messageCount} ${t("chat.messages")}`
                            : ""}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* 文件结果 */}
            {fileResults.length > 0 && (
              <div>
                <div className="px-4 py-2 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider border-t border-gray-100 dark:border-gray-700">
                  {t("chat.files")}
                </div>
                {fileResults.map((file, idx) => (
                  <button
                    key={file.fileId || idx}
                    onClick={handleFileClick}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <span className="text-base shrink-0">📄</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-gray-800 dark:text-gray-200 truncate">
                        {file.originalName}
                      </div>
                      <div className="text-xs text-gray-400 dark:text-gray-500 truncate font-mono">
                        {file.savedPath}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* 知识库结果 */}
            {knowledgeResults.length > 0 && (
              <div>
                <div className="px-4 py-2 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider border-t border-gray-100 dark:border-gray-700">
                  {t("chat.knowledge")}
                </div>
                {knowledgeResults.map((item, idx) => (
                  <button
                    key={item.id || idx}
                    onClick={handleKnowledgeClick}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                  >
                    <span className="text-base shrink-0">📚</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-gray-800 dark:text-gray-200 truncate">
                        {item.title || item.content?.slice(0, 60)}
                      </div>
                      <div className="text-xs text-gray-400 dark:text-gray-500 truncate">
                        {item.tags?.length ? item.tags.join(", ") : ""}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 底部提示 */}
          <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700 flex items-center gap-4 text-[10px] text-gray-400">
            <span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded font-mono text-[10px]">
                ↑↓
              </kbd>{" "}
              {t("chat.navigateHint")}
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded font-mono text-[10px]">
                Enter
              </kbd>{" "}
              {t("chat.openHint")}
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded font-mono text-[10px]">
                Esc
              </kbd>{" "}
              {t("chat.closeHint")}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
