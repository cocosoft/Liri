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

/** 搜索结果会话：Session + 模块类型（用于跳转正确页面，Session 类型本身无此字段） */
type SearchResultSession = Session & { moduleType?: string };

/** M4 修复：扁平化搜索结果项（键盘导航用，判别联合类型） */
type SearchItem =
  | { kind: "session"; session: SearchResultSession }
  | { kind: "file"; file: FileRegistryRecord }
  | { kind: "knowledge"; item: KnowledgeItem };
import type { FileRegistryRecord } from "../../types/file";
import type { KnowledgeItem } from "../../types/knowledge";

/** 模块类型 → AppPage 映射（media/office/calendar/translation 无独立页面，回退 chat） */
const MODULE_PAGE: Record<string, AppPage> = {
  chat: "chat",
  knowledge: "knowledge",
  files: "files",
  workspace: "workspace",
  media: "chat",
  office: "chat",
  calendar: "chat",
  translation: "chat",
};

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
  const [sessionResults, setSessionResults] = useState<SearchResultSession[]>(
    [],
  );
  const [fileResults, setFileResults] = useState<FileRegistryRecord[]>([]);
  const [knowledgeResults, setKnowledgeResults] = useState<KnowledgeItem[]>([]);
  const [searching, setSearching] = useState(false);
  // M4 修复：请求序号，旧请求晚返回时丢弃（防抖竞态）
  const searchSeqRef = useRef(0);
  // M4 修复：键盘导航选中项（扁平化结果列表下标）
  const [activeIndex, setActiveIndex] = useState(-1);
  // P1-10: 搜索源从 chatSessions 改为 SessionHub 全量（含 media/office 等模块会话）
  const sessionsRecord = useRootStore((s) => s.sessions);
  const worktrees = useRootStore((s) => s.worktrees);
  const allSessions = useMemo(
    () => Object.values(sessionsRecord),
    [sessionsRecord],
  );
  const switchWorkspace = useRootStore((s) => s.switchWorkspace);
  const switchSession = useSessionStore((s) => s.switchSession);
  const setActivePage = useNavigationStore((s) => s.setActivePage);

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

  /** 300ms 防抖搜索（M4：带请求序号，旧请求晚返回不覆盖新结果） */
  useEffect(() => {
    if (!query.trim()) {
      searchSeqRef.current += 1; // 使在途请求全部失效
      setSearching(false);
      setSessionResults([]);
      setFileResults([]);
      setKnowledgeResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      const q = query.toLowerCase();
      const seq = ++searchSeqRef.current;
      // 竞态排查：本次请求序号——若后续"stale:drop"日志与完成日志交错，
      // 说明存在旧请求晚返回覆盖新结果的风险（序号机制应丢弃旧请求）
      logger.info("search:start", { query: q, seq });

      // 1. 客户端过滤所有模块会话标题（SessionHub 全量）
      //    SessionRecord 有 title 字段，转为 Session-like 结构用于搜索
      const matchedSessions = allSessions
        .filter((s) => s.title?.toLowerCase().includes(q))
        .slice(0, 5);
      if (seq !== searchSeqRef.current) {
        // 竞态排查：旧请求在"会话过滤"阶段被新请求取代
        logger.info("search:staleDrop", {
          seq,
          current: searchSeqRef.current,
          stage: "sessions",
        });
        return;
      }
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
              // 携带归属信息：workspaceId（worktree ID）+ moduleType（模块类型，用于跳转）
              workspaceId: s.workspaceId,
              moduleType: s.moduleType,
            }) as SearchResultSession,
        ),
      );

      // 2. 异步搜索文件
      try {
        const fileRes = await fileService.searchFiles({ query: q, limit: 5 });
        if (seq !== searchSeqRef.current) {
          logger.info("search:staleDrop", {
            seq,
            current: searchSeqRef.current,
            stage: "files",
          });
          return;
        }
        setFileResults(fileRes.items.slice(0, 5));
      } catch (e) {
        if (seq !== searchSeqRef.current) return;
        handleClientError(e, {
          module: "components:chat:GlobalSearch",
          action: "searchFiles",
        });
        setFileResults([]);
      }

      // 3. 异步搜索知识库
      try {
        const kbRes = await knowledgeService.search(q);
        if (seq !== searchSeqRef.current) {
          logger.info("search:staleDrop", {
            seq,
            current: searchSeqRef.current,
            stage: "knowledge",
          });
          return;
        }
        setKnowledgeResults((kbRes as KnowledgeItem[]).slice(0, 5));
      } catch (e) {
        if (seq !== searchSeqRef.current) return;
        handleClientError(e, {
          module: "components:chat:GlobalSearch",
          action: "searchKnowledge",
        });
        setKnowledgeResults([]);
      }

      // 竞态排查：请求完成（未被新请求取代）——与 search:start 成对出现；
      // 若只有 start 无 complete 也无 staleDrop，说明请求卡在 await（排查服务超时）
      logger.info("search:complete", {
        query: q,
        seq,
        sessionCount: matchedSessions.length,
      });
      setSearching(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, allSessions]);

  /** M4 修复：扁平化结果列表，供键盘导航定位（顺序 = 会话 → 文件 → 知识库） */
  const items = useMemo<readonly SearchItem[]>(
    () => [
      ...sessionResults.map((session) => ({
        kind: "session" as const,
        session,
      })),
      ...fileResults.map((file) => ({ kind: "file" as const, file })),
      ...knowledgeResults.map((item) => ({ kind: "knowledge" as const, item })),
    ],
    [sessionResults, fileResults, knowledgeResults],
  );

  // M4 修复：查询/结果变化时重置选中项
  useEffect(() => {
    setActiveIndex(-1);
  }, [query, items]);

  /** 点击会话结果：切换工作空间 + 会话 + 跳转正确模块页面 */
  const handleSessionClick = useCallback(
    async (session: SearchResultSession) => {
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
          await switchWorkspace(session.workspaceId);
        }
        await switchSession(session.id);
        // 修复：原用 workspaceId（worktree ID，形如 wt_xxx）查模块类型表必然 miss、
        // 永远 fallback "chat"——改用 SessionRecord 携带的 moduleType（chat/media/office/...）
        const page = MODULE_PAGE[session.moduleType ?? "chat"] ?? "chat";
        // 排查跳转目标：记录 moduleType → page 解析结果，确认会话归属模块是否正确
        logger.info("GlobalSearchModal: 切换会话并导航", {
          sessionId: session.id,
          sessionTitle: session.title,
          workspaceId: session.workspaceId,
          moduleType: session.moduleType,
          targetPage: page,
        });

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
    [switchSession, switchWorkspace, setActivePage, onClose],
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

  /** M4 修复：Escape 关闭 + ↑↓ 导航 + Enter 打开（此前提示存在但未实现） */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev - 1 + items.length) % items.length);
    } else if (e.key === "Enter" && activeIndex >= 0) {
      const item = items[activeIndex];
      if (!item) return;
      e.preventDefault();
      if (item.kind === "session") void handleSessionClick(item.session);
      else if (item.kind === "file") handleFileClick();
      else handleKnowledgeClick();
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
                {sessionResults.map((session, i) => {
                  const ctx = getSessionContext(session);
                  const isActive = activeIndex === i;
                  return (
                    <button
                      key={session.id}
                      onClick={() => handleSessionClick(session)}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        isActive
                          ? "bg-blue-50 dark:bg-blue-900/30"
                          : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      }`}
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
                {fileResults.map((file, i) => {
                  const globalIdx = sessionResults.length + i;
                  const isActive = activeIndex === globalIdx;
                  return (
                    <button
                      key={file.fileId || i}
                      onClick={handleFileClick}
                      onMouseEnter={() => setActiveIndex(globalIdx)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        isActive
                          ? "bg-blue-50 dark:bg-blue-900/30"
                          : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      }`}
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
                  );
                })}
              </div>
            )}

            {/* 知识库结果 */}
            {knowledgeResults.length > 0 && (
              <div>
                <div className="px-4 py-2 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider border-t border-gray-100 dark:border-gray-700">
                  {t("chat.knowledge")}
                </div>
                {knowledgeResults.map((item, i) => {
                  const globalIdx =
                    sessionResults.length + fileResults.length + i;
                  const isActive = activeIndex === globalIdx;
                  return (
                    <button
                      key={item.id || i}
                      onClick={handleKnowledgeClick}
                      onMouseEnter={() => setActiveIndex(globalIdx)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        isActive
                          ? "bg-blue-50 dark:bg-blue-900/30"
                          : "hover:bg-gray-50 dark:hover:bg-gray-700/50"
                      }`}
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
                  );
                })}
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
