import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import ChatMessage from "./ChatMessage";
import SessionTitle from "./SessionTitle";
import type { Message } from "../../types";
import { SkeletonMessageList } from "../common/Skeleton";
import { useSessionStore } from "../../stores/sessionStore";
import { useChatInspectorStore } from "../../stores/chatInspectorStore";
import { useChatStore } from "../../stores/chat";
import { ErrorBoundary } from "../common/ErrorBoundary";
import { shouldShowDateSeparator, formatDateLabel } from "./dateUtils";
import { VirtualScrollProvider } from "./VirtualScrollContext";
import { getMessageSearchText } from "../../utils/messageText";

/** 入门提示卡片数据 */
interface StarterPrompt {
  icon: string;
  labelKey: string;
  promptTextKey: string;
}

/** 默认入门提示卡片列表（图标 + 标签 key + 提示文本 key） */
const STARTER_PROMPTS: StarterPrompt[] = [
  {
    icon: "💡",
    labelKey: "chat.starterExplain",
    promptTextKey: "chat.starterExplainText",
  },
  {
    icon: "📝",
    labelKey: "chat.starterWrite",
    promptTextKey: "chat.starterWriteText",
  },
  {
    icon: "🔍",
    labelKey: "chat.starterResearch",
    promptTextKey: "chat.starterResearchText",
  },
  {
    icon: "🎨",
    labelKey: "chat.starterCreate",
    promptTextKey: "chat.starterCreateText",
  },
];

/** 消息级别的轻量级错误降级 UI */
function MessageErrorFallback({ error }: { error: Error | null }) {
  const { t } = useTranslation();
  return (
    <div
      className="flex items-center gap-3 p-4 mx-2 my-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"
      role="alert"
    >
      <span className="text-lg shrink-0" aria-hidden="true">
        ⚠️
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-red-700 dark:text-red-300">
          {t("chat.messageRenderError")}
        </p>
        <p className="text-xs text-red-500 dark:text-red-400 truncate mt-0.5">
          {error?.message || t("common.noData")}
        </p>
      </div>
    </div>
  );
}

/**
 * 搜索栏组件
 * 在消息列表顶部叠加显示搜索输入框和结果导航
 */
function SearchBar({
  query,
  onQueryChange,
  matchCount,
  currentIndex,
  onPrev,
  onNext,
  onClose,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  matchCount: number;
  currentIndex: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="sticky top-0 z-20 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-4 py-2 flex items-center gap-3">
      <svg
        className="w-4 h-4 text-gray-400 shrink-0"
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
        id="message-search-input"
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.shiftKey ? onPrev() : onNext();
          } else if (e.key === "Escape") {
            onClose();
          }
        }}
        placeholder={t("chat.searchSessions")}
        className="flex-1 text-sm bg-transparent border-none outline-none text-gray-800 dark:text-gray-200 placeholder-gray-400"
      />
      {query && (
        <span className="text-xs text-gray-500 shrink-0 whitespace-nowrap">
          {matchCount > 0
            ? `${currentIndex + 1}/${matchCount} ${t("chat.searchResults")}`
            : t("chat.noResults")}
        </span>
      )}
      {matchCount > 1 && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onPrev}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
            title={t("chat.prevMatch")}
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
                d="M5 15l7-7 7 7"
              />
            </svg>
          </button>
          <button
            onClick={onNext}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
            title={t("chat.nextMatch")}
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
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
        </div>
      )}
      <button
        onClick={onClose}
        className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600"
        title={t("chat.closeSearch")}
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
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}

/**
 * 搜索栏组件
 * 在消息列表顶部叠加显示搜索输入框和结果导航
 */

/**
 * P1-17（2026-09-27，D5=B 二次修订）：**会话 → 距尾偏移锚点**（LRU 50）。
 *
 * 为什么不用"绝对消息 id"：长会话是**尾部分页**（"↑ 加载更早消息"，切换间已加载集合会变化，
 * 实测 11↔22 条）⇒ 切回时锚点消息可能**尚未加载**，idx=-1 → 退化为贴底/落顶（第 5、6 轮实测）。
 * 尾部消息集在这些场景下是稳定的参照，故改存 `offsetFromEnd = loadedCount − 1 − topVisibleIndex`：
 *  - 分页前插更早消息时，该偏移不变（尾部对齐）；
 *  - 切回后按 `targetIndex = loadedCount − 1 − offsetFromEnd` 定位（idx=0 时用 align "end" 贴底）。
 */
const SCROLL_ANCHORS = new Map<string, number>();
const SCROLL_ANCHOR_MAX = 50;
/** 恢复窗口：内容异步到达 + 惰性测高期内，**定时重应用**目标（毫秒）。
 *  取 5s 以覆盖"HTTP 取消息 + 两阶段渲染"（整页加载实测内容在 1–2s 内陆续到达） */
const RESTORE_WINDOW_MS = 5000;
/** 重应用节拍：必须定时（而非只在消息数变化时），否则惰性测高期间位置会被 clamp 在中段 */
const RESTORE_TICK_MS = 120;
/** 判定"用户手动滚动"的宽限期：距上次程序滚动超过该值即视为用户操作。
 *  取值需 > 程序滚动的 scroll 事件延迟（约 1 帧），又 < 重应用节拍（120ms）以便及时取消 */
const USER_SCROLL_GRACE_MS = 80;
/** 窗口起始静默期：此期间内的滚动事件多为布局/惰性测高引起（非用户操作），不据此取消恢复 */
const RESTORE_INITIAL_GRACE_MS = 800;

interface ChatMessageListProps {
  messages: Message[];
  isStreaming: boolean;
  sessionUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  /** 无会话时显示 */
  hasSession: boolean;
  /** 当前会话标题（空消息时展示） */
  sessionTitle?: string;
  /**
   * P0-2 防御：当前会话 ID——用于校验消息区内容与侧栏高亮的一致性。
   * 渲染只按 messages.length 判断不校验 session_id，若 store 层守卫出现
   * 新竞态路径（或历史数据错位），会显示上一个会话的旧消息；此处兜底。
   */
  currentSessionId?: string;
  /** W3：虚拟滚动滚动容器引用（overflow-y-auto 容器在 ChatArea） */
  scrollRef?: React.RefObject<HTMLDivElement | null>;
  /** 创建新会话回调（欢迎页按钮） */
  onCreateSession?: () => void;
  /** 发送入门提示消息回调 */
  onSendMessage?: (text: string) => void;
}

/** 聊天消息列表：消息渲染 + 空状态展示 + 搜索 + 导出 */
export default function ChatMessageList({
  messages,
  isStreaming,
  sessionUsage,
  hasSession,
  sessionTitle,
  currentSessionId,
  scrollRef,
  onCreateSession,
  onSendMessage,
}: ChatMessageListProps) {
  const { t } = useTranslation();
  const switching = useSessionStore((s) => s.switching);
  // KB-LONG-SESSION（2026-08-29）：长会话分页——"加载更早消息"状态与动作
  const hasOlder = useChatStore((s) => s.hasOlder);
  const loadingOlder = useChatStore((s) => s.loadingOlder);
  const loadOlderMessages = useChatStore((s) => s.loadOlderMessages);
  /** P1-6b：分页游标——为 null 时"加载更早"不可用（动作会静默失败），UI 需给出原因 */
  const oldestSeq = useChatStore((s) => s.oldestSeq);

  // W3：虚拟滚动——仅渲染视口 ± overscan 内的消息，长会话不再全量挂载
  // （每条消息含 KaTeX/mermaid/代码高亮，几千条时全量渲染导致首屏/切换卡顿）
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: () => 96,
    overscan: 10,
    getItemKey: (index) => messages[index]?.id ?? index,
  });

  // P3-5 修复（前端交互专项 2026-08-30）："加载更早消息"把更早消息前插到数组头，
  // tanstack-virtual 的测量缓存按索引存储（getItemKey 只保证 React 元素稳定），
  // 前插后所有后续索引整体后移 → 已测量高度被错误复用 → 滚动闪跳/高度抖动。
  // 检测 messages 首条 id 变化（前插/切会话）时重测可见项高度，修正缓存错位。
  const firstMessageId = messages[0]?.id;
  const prevFirstIdRef = useRef(firstMessageId);
  useEffect(() => {
    if (prevFirstIdRef.current !== firstMessageId) {
      virtualizer.measure();
    }
    prevFirstIdRef.current = firstMessageId;
  }, [firstMessageId, virtualizer]);

  // ── P1-17：位置记忆（消息索引锚点）与恢复 ─────────────────────────────
  /** 最新 messages（供切换 effect 读取，避免把 messages 放进依赖导致流式期间反复重定位） */
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  /** 恢复窗口（窗口期内随消息增长重应用目标） */
  const restoreWindowRef = useRef<{
    startAt: number;
    until: number;
    mode: "anchor" | "bottom";
  } | null>(null);
  /** 恢复窗口的定时器（用户手动滚动时需立即取消） */
  const restoreTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 最近一次**程序触发**滚动的时间戳（用于区分用户滚动） */
  const lastProgrammaticScrollAtRef = useRef(0);

  /** 保存锚点：滚动时记录"当前会话顶部可见消息"的距尾偏移 */
  useEffect(() => {
    const el = scrollRef?.current;
    if (!el || !currentSessionId) return;
    /** rAF 句柄：scroll 事件里逐个读几何会强制同步布局，连续滚动时按帧去抖 */
    let rafId = 0;

    /**
     * 顶部**可见**消息索引（DOM 几何判定）。
     *
     * ⚠️ 不能用 `virtualizer.getVirtualItems()[0].index`（第 7 轮真机定位）：
     *  ① 它是最小**已渲染**索引（含 overscan=10），比真实阅读位置靠前 10 条；
     *  ② scroll 事件当拍 React 尚未按新 `scrollTop` 重渲染，读到的是**上一帧**范围
     *     ——实测"从底部向上滚"被记成底部的 overscan 起点（锚点 10 而非 29），
     *     切回后 `scrollToIndex(19)` 落点 `translateY(19)=76144`，偏 9 条。
     * 故延后一帧、按"渲染顺序首条底边越过容器顶边"取索引（渲染顺序即索引顺序）。
     */
    const readTopVisibleIndex = (): number => {
      const containerTop = el.getBoundingClientRect().top;
      for (const node of el.querySelectorAll<HTMLElement>("[data-index]")) {
        if (node.getBoundingClientRect().bottom > containerTop) {
          return Number(node.dataset.index);
        }
      }
      return -1;
    };

    const saveAnchor = () => {
      // ③ 用户手动滚动 ⇒ 取消恢复窗口（否则窗口期的定时重应用会把位置抢回去）。
      //    起始静默期内不据此取消：加载/测高期的 scroll 事件并非用户操作（否则会误取消，
      //    实测表现为整页加载后确定性停在会话中段 distance≈66092）。
      const win0 = restoreWindowRef.current;
      const inInitialGrace =
        win0 != null && Date.now() < win0.startAt + RESTORE_INITIAL_GRACE_MS;
      if (
        !inInitialGrace &&
        Date.now() - lastProgrammaticScrollAtRef.current > USER_SCROLL_GRACE_MS
      ) {
        restoreWindowRef.current = null;
        if (restoreTimerRef.current) {
          clearInterval(restoreTimerRef.current);
          restoreTimerRef.current = null;
        }
      }
      // ① 恢复窗口内不记录：此时的滚动多由本组件程序触发（含跨会话瞬态的 scrollTop 归零），
      //    记录会把锚点污染成"别的会话的首条消息"（实测切回后落到会话开头/底部即此因）
      const win = restoreWindowRef.current;
      if (win && Date.now() < win.until) return;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        // 延期期间窗口可能被开启/取消，二次确认后再记录
        const w = restoreWindowRef.current;
        if (w && Date.now() < w.until) return;
        const topIndex = readTopVisibleIndex();
        if (topIndex < 0) return;
        const msg = messagesRef.current[topIndex];
        // ② 只记录**属于当前会话**的消息（渲染层可能短暂持有旧会话消息）
        if (!msg || msg.session_id !== currentSessionId) return;
        if (
          SCROLL_ANCHORS.size >= SCROLL_ANCHOR_MAX &&
          !SCROLL_ANCHORS.has(currentSessionId)
        ) {
          const oldest = SCROLL_ANCHORS.keys().next().value;
          if (oldest) SCROLL_ANCHORS.delete(oldest);
        }
        // 距尾偏移（0 = 顶部可见项即最后一条消息）
        SCROLL_ANCHORS.set(
          currentSessionId,
          Math.max(0, messagesRef.current.length - 1 - topIndex),
        );
      });
    };
    el.addEventListener("scroll", saveAnchor, { passive: true });
    return () => {
      el.removeEventListener("scroll", saveAnchor);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [scrollRef, currentSessionId, virtualizer]);

  /**
   * 会话切换：有锚点 → 按索引恢复到该消息（align start）；无锚点 → 贴底。
   * **定时重应用**至窗口结束：虚拟列表在窗口内持续惰性测高，若只应用一次/只在消息数变化时应用，
   * 会被当时的（偏小的）`scrollHeight` clamp 在会话中段（实测 distance≈66092）。
   *
   * ⚠️ 关键（2026-09-27 第 5 轮真机）：**消息异步到达时不能 early-return** —— 早期实现在
   * `messages.length === 0` 时直接返回 ⇒ 定时器从未启动 ⇒ 整页加载/切换后落在会话中段（确定性）。
   * 现改为：窗口与定时器**无条件启动**，目标在每拍解析（消息到位后自然生效）。
   */
  useEffect(() => {
    if (!currentSessionId) return;
    const startAt = Date.now();
    const deadline = startAt + RESTORE_WINDOW_MS;
    restoreWindowRef.current = { startAt, until: deadline, mode: "bottom" };

    const apply = () => {
      const win = restoreWindowRef.current;
      if (!win) return;
      const cur = messagesRef.current;
      if (cur.length === 0) return; // 消息未到达：等下一拍（窗口不因此取消）
      lastProgrammaticScrollAtRef.current = Date.now();
      const offsetFromEnd = SCROLL_ANCHORS.get(currentSessionId);
      if (offsetFromEnd !== undefined) {
        win.mode = "anchor";
        // 距尾偏移 0 ⇒ 当时就在底部：直接对齐尾部；否则对齐该条消息顶部
        if (offsetFromEnd <= 0) {
          virtualizer.scrollToIndex(cur.length - 1, { align: "end" });
        } else {
          const idx = Math.max(0, cur.length - 1 - offsetFromEnd);
          virtualizer.scrollToIndex(idx, { align: "start" });
        }
        return;
      }
      win.mode = "bottom";
      virtualizer.scrollToIndex(cur.length - 1, { align: "end" });
    };

    apply();
    const timer = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(timer);
        restoreTimerRef.current = null;
        return;
      }
      apply();
    }, RESTORE_TICK_MS);
    restoreTimerRef.current = timer;

    return () => {
      clearInterval(timer);
      restoreTimerRef.current = null;
    };
  }, [currentSessionId, virtualizer]);

  // P0-2 防御：消息区内容与当前会话一致性校验——渲染层兜底，不依赖 store 守卫。
  // 若 messages 首条 session_id 与 currentSessionId 不一致（切换竞态/数据错位），
  // 按"加载中"处理（骨架屏）而非渲染可能错位的旧会话消息。
  const sessionMismatch =
    messages.length > 0 &&
    currentSessionId != null &&
    messages[0]?.session_id !== currentSessionId;

  // 搜索状态
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  /** 计算搜索匹配的消息 ID 列表 */
  const matchedIds = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return messages
      .filter((msg) => getMessageSearchText(msg).toLowerCase().includes(q))
      .map((msg) => msg.id);
  }, [messages, searchQuery]);

  /** 处理搜索导航：滚动到指定匹配消息 */
  const scrollToMatch = useCallback(
    (index: number) => {
      const id = matchedIds[index];
      if (!id) return;
      // W3：虚拟列表下离屏消息不在 DOM，按消息索引 scrollToIndex（替代 querySelectorAll）
      const msgIndex = messages.findIndex((m) => m.id === id);
      if (msgIndex >= 0) {
        virtualizer.scrollToIndex(msgIndex, { align: "center" });
      }
    },
    [matchedIds, messages, virtualizer],
  );

  /** 上一个匹配 */
  const goToPrevMatch = useCallback(() => {
    if (matchedIds.length === 0) return;
    const next =
      (currentMatchIndex - 1 + matchedIds.length) % matchedIds.length;
    setCurrentMatchIndex(next);
    scrollToMatch(next);
  }, [matchedIds, currentMatchIndex, scrollToMatch]);

  /** 下一个匹配 */
  const goToNextMatch = useCallback(() => {
    if (matchedIds.length === 0) return;
    const next = (currentMatchIndex + 1) % matchedIds.length;
    setCurrentMatchIndex(next);
    scrollToMatch(next);
  }, [matchedIds, currentMatchIndex, scrollToMatch]);

  /**
   * P1-1 修复：上下文面板高亮跳转下沉到列表内部（替代 ChatArea 的 querySelectorAll）。
   * 虚拟列表下离屏消息不在 DOM，DOM 查询静默失效；此处用 virtualizer.scrollToIndex
   * 先滚动（目标进入视口后才渲染），再 rAF 一次挂高亮闪烁。
   */
  const highlightedRoundId = useChatInspectorStore((s) => s.highlightedRoundId);
  const setHighlightedRoundId = useChatInspectorStore(
    (s) => s.setHighlightedRoundId,
  );
  useEffect(() => {
    if (!highlightedRoundId) return;
    requestAnimationFrame(() => {
      const msgIndex = messages.findIndex((m) => m.id === highlightedRoundId);
      if (msgIndex >= 0) {
        virtualizer.scrollToIndex(msgIndex, { align: "center" });
        // 滚动完成、目标消息渲染后再加高亮闪烁
        requestAnimationFrame(() => {
          const el = Array.from(
            document.querySelectorAll<HTMLElement>("[data-msg-id]"),
          ).find((n) => n.getAttribute("data-msg-id") === highlightedRoundId);
          if (el) {
            el.classList.add("ring-2", "ring-blue-400", "ring-offset-1");
            setTimeout(() => {
              el.classList.remove("ring-2", "ring-blue-400", "ring-offset-1");
            }, 1500);
          }
        });
      }
      // 重置以允许重复点击同一消息
      setHighlightedRoundId(null);
    });
  }, [highlightedRoundId, messages, virtualizer, setHighlightedRoundId]);

  /** 切换搜索 */
  const toggleSearch = useCallback(() => {
    setSearchOpen((prev) => {
      if (prev) {
        setSearchQuery("");
        setCurrentMatchIndex(0);
      }
      return !prev;
    });
  }, []);

  /** 关闭搜索 */
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
    setCurrentMatchIndex(0);
  }, []);

  /** Ctrl+F / Cmd+F 快捷键 */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        toggleSearch();
      } else if (e.key === "Escape" && searchOpen) {
        e.preventDefault();
        closeSearch();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [searchOpen, toggleSearch, closeSearch]);

  /** 搜索 query 变化时重置索引 */
  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [searchQuery]);

  /** 匹配集用于高亮标记 */
  const matchedSet = useMemo(() => new Set(matchedIds), [matchedIds]);

  /** P2-3 修复：lastAssistantIdx 改 findLastIndex 提前退出（O(n) → 平均 O(n/2)） */
  const lastAssistantIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  }, [messages]);

  /**
   * 被回复消息 id 集合（AB-20：避免每条消息 O(n) 扫描 replyToId → 整列表 O(n²)）。
   * P2-3 修复：流式期间 messages 引用每 chunk 变化，复用上次结果避免每 chunk O(n) 重算；
   * 流式期间最后一条 assistant 消息在变，replyToId 关系几乎不变（新消息 replyToId 恒为空），复用安全。
   */
  const repliedIdSetRef = useRef<Set<string>>(new Set());
  /** F6（2026-08-25）：记录上次已合并 replyToId 的消息数，流式期间仅增量合并新增 */
  const repliedIdSetLenRef = useRef(0);
  const repliedIdSet = useMemo(() => {
    if (isStreaming && repliedIdSetRef.current.size > 0) {
      // F6（2026-08-25）：流式期间 messages 引用每 chunk 变化，不复用空结果；
      // 若消息数增加（message_queue 流式中发送带 replyToId 的新消息），增量合并新 replyToId，
      // 避免"被回复"标记流式期间不更新（原实现复用旧 set，新 replyToId 缺失）
      if (messages.length > repliedIdSetLenRef.current) {
        const next = new Set(repliedIdSetRef.current);
        for (let i = repliedIdSetLenRef.current; i < messages.length; i++) {
          const rid = messages[i].replyToId;
          if (rid) next.add(rid);
        }
        repliedIdSetRef.current = next;
        repliedIdSetLenRef.current = messages.length;
      }
      return repliedIdSetRef.current;
    }
    const set = new Set(
      messages.map((m) => m.replyToId).filter(Boolean) as string[],
    );
    repliedIdSetRef.current = set;
    repliedIdSetLenRef.current = messages.length;
    return set;
  }, [messages, isStreaming]);

  // 重置导出菜单标识
  if (!hasSession) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center px-8">
          <div className="w-20 h-20 mx-auto mb-4 flex items-center justify-center">
            <img
              src="/liri_logo.png"
              alt="Liri Logo"
              className="w-20 h-20 object-contain"
              onError={(e) => {
                // 头像加载失败时显示首字母 fallback
                // N3 修复：改用 DOM API 创建元素（原 innerHTML 注入虽为常量，
                // 但一旦拼接动态值即成 XSS 点）
                const img = e.target as HTMLImageElement;
                img.style.display = "none";
                const parent = img.parentElement;
                if (!parent) return;
                const fallback = document.createElement("div");
                fallback.className =
                  "w-20 h-20 rounded-full bg-blue-500 flex items-center justify-center text-white text-3xl font-bold";
                fallback.textContent = "L";
                parent.appendChild(fallback);
              }}
            />
          </div>
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-2">
            {t("chat.welcomeTitle")}
          </h2>
          <p className="text-gray-500 dark:text-gray-400">
            {t("chat.welcomeOfficialSite", "官网: https://openliri.com")}
          </p>
          <p className="text-gray-500 dark:text-gray-400 mt-1 mb-8">
            {t("chat.welcomeHint")}
          </p>
          <button
            onClick={onCreateSession}
            className="inline-flex items-center gap-2 px-8 py-3.5 text-base font-medium text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 rounded-xl shadow-lg hover:shadow-xl transition-all"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4v16m8-8H4"
              />
            </svg>
            {t("chat.startChat")}
          </button>
        </div>
      </div>
    );
  }

  // P0-2 防御：消息区与当前会话不一致（切换竞态/数据错位）→ 骨架屏兜底，
  // 不渲染可能属于上一个会话的旧消息（与"加载中"体验一致，避免错位闪现）
  if (sessionMismatch) {
    return <SkeletonMessageList count={2} />;
  }

  // "有 session 无消息"状态：灰色圆角容器 + 提示
  if (messages.length === 0) {
    if (isStreaming || switching) {
      return <SkeletonMessageList count={2} />;
    }

    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center px-8">
          <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 dark:bg-gray-800 rounded-xl flex items-center justify-center text-3xl">
            💬
          </div>
          <SessionTitle
            text={sessionTitle}
            fallback={t("chat.untitledSession")}
            as="h2"
            truncate={false}
            className="text-lg font-medium text-gray-800 dark:text-gray-200 mb-2"
          />
          <div className="rounded-2xl bg-gray-50 dark:bg-gray-800 px-6 py-3 mt-3">
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {t("chat.noMessages")}
            </p>
          </div>

          {/* 入门提示卡片：点击直接发送预设消息 */}
          <div className="mt-5 grid grid-cols-2 gap-2 max-w-sm mx-auto">
            {STARTER_PROMPTS.map((prompt) => (
              <button
                key={prompt.labelKey}
                onClick={() => onSendMessage?.(t(prompt.promptTextKey))}
                className="flex items-center gap-2 px-3 py-2.5 text-left text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all active:scale-[0.98]"
              >
                <span className="text-base shrink-0">{prompt.icon}</span>
                <span className="text-gray-700 dark:text-gray-300 font-medium truncate">
                  {t(prompt.labelKey)}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-center gap-2">
            <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full text-xs text-gray-500">
              {t("chat.markdownSupport")}
            </span>
            <span className="px-3 py-1 bg-gray-100 dark:bg-gray-800 rounded-full text-xs text-gray-500">
              {t("chat.enterToSend")}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <VirtualScrollProvider virtualizer={virtualizer} messages={messages}>
      <div className="relative">
        {/* 顶部工具栏：搜索 + 导出 */}
        {searchOpen && (
          <SearchBar
            query={searchQuery}
            onQueryChange={setSearchQuery}
            matchCount={matchedIds.length}
            currentIndex={currentMatchIndex}
            onPrev={goToPrevMatch}
            onNext={goToNextMatch}
            onClose={closeSearch}
          />
        )}

        {/* 搜索按钮（固定在右上角，搜索栏打开时隐藏） */}
        {!searchOpen && (
          <div className="sticky top-0 z-10 flex items-center justify-end gap-1 px-4 py-1.5 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm">
            <button
              onClick={toggleSearch}
              className="p-1.5 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              title={t("common.search")}
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
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </button>
          </div>
        )}

        {/* KB-LONG-SESSION（2026-08-29）：长会话分页——还有更早历史时显示"加载更早消息"。
            P1-6b（2026-09-27）：游标缺失（`oldestSeq == null`，后端尾页未带 lastEventSeq）时
            动作会静默失败 ⇒ 改为**不可用态 + 原因提示**，不再出现"点了没反应"。 */}
        {hasOlder && (
          <div className="flex justify-center py-2">
            {oldestSeq == null ? (
              <span
                className="text-xs px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed"
                title={t("chat.loadOlderUnavailable")}
              >
                {t("chat.loadOlderUnavailableLabel")}
              </span>
            ) : (
              <button
                onClick={() => void loadOlderMessages()}
                disabled={loadingOlder}
                title={t("chat.loadOlder")}
                className="text-xs px-3 py-1.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
              >
                {loadingOlder ? t("chat.loadingOlder") : t("chat.loadOlder")}
              </button>
            )}
          </div>
        )}

        {/* 消息列表（W3 虚拟滚动：仅渲染视口 ± overscan，长会话不再全量挂载） */}
        <div
          className="py-4 relative"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const message = messages[virtualRow.index];
            const i = virtualRow.index;
            const isMatched = matchedSet.has(message.id);
            const isCurrentMatch =
              matchedIds.length > 0 &&
              matchedIds[currentMatchIndex] === message.id;
            const hasReplies = repliedIdSet.has(message.id);

            return (
              <div
                key={message.id}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {/* 日期分隔线：跨天时插入 */}
                {shouldShowDateSeparator(i, messages) && (
                  <div
                    className="flex items-center justify-center py-2"
                    role="separator"
                    aria-label={formatDateLabel(message.timestamp!)}
                  >
                    <span className="rounded-full bg-gray-200 dark:bg-gray-700 px-3 py-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {formatDateLabel(message.timestamp!)}
                    </span>
                  </div>
                )}

                <div
                  data-msg-id={message.id}
                  className={`transition-colors ${
                    message.role === "user"
                      ? "animate-message-enter-right"
                      : "animate-message-enter-left"
                  } ${
                    isMatched
                      ? "bg-yellow-50/40 dark:bg-yellow-900/10 border-l-2 border-yellow-400 dark:border-yellow-500"
                      : "border-l-2 border-transparent"
                  } ${isCurrentMatch ? "bg-yellow-100/60 dark:bg-yellow-900/20 ring-1 ring-yellow-400/30" : ""}`}
                >
                  <ErrorBoundary
                    fallback={<MessageErrorFallback error={null} />}
                  >
                    <ChatMessage
                      message={message}
                      isStreaming={
                        isStreaming &&
                        message.role === "assistant" &&
                        i === lastAssistantIdx
                      }
                      hasReplies={hasReplies}
                      sessionUsage={sessionUsage}
                    />
                  </ErrorBoundary>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </VirtualScrollProvider>
  );
}
