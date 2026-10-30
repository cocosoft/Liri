import { useMemo, useCallback, useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Message } from "../../types";
import { useChatInspectorStore } from "../../stores/chatInspectorStore";
import { summarizeRoundText } from "../../utils/roundSummaries";
// B2（2026-10-30）：整会话按轮摘要（一次请求），用于补齐**未加载**轮次
import { useSessionRoundSummaries } from "../../hooks/useSessionRoundSummaries";

interface RoundNavigatorProps {
  messages: Message[];
  isStreaming: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /**
   * P1-6a（2026-09-27，D8 = 统一到总量 + 尾锚定）：**会话总轮数** —— 与 header 徽标 /
   * 侧栏 / 导出同源，取后端持久化 `session.roundCount`。
   *
   * 为什么不能只数 `messages`：长会话是**尾部分页**（每页 30 条），尾页可能
   * **一条 user 消息都没有**（实测某"21 轮"会话：全量 709 条、最后一条 user 距尾 47 条）
   * ⇒ 原实现按"已加载 user 条数"计轮得 0，`rounds.length <= 1` 成立 ⇒ 组件 return null
   * ⇒ 真机表现为**导航器整体消失**（不是少显示几轮）。故轮数以总量为准，
   * 已加载部分按**尾部对齐**映射为绝对轮号。
   */
  totalRounds: number;
  /** 是否还有更早消息可加载（驱动「更早 N 轮未加载」入口的可用性） */
  hasOlder: boolean;
  /** 加载更早消息（复用既有分页动作，CS01 不另立实现） */
  onLoadOlder: () => void;
  /**
   * B2（2026-10-30）：会话 id —— 拉取全量按轮摘要，让**未加载**轮次也显示摘要
   * （此前只能对已加载的一页算摘要：真机 26 轮会话只显示最近 9 轮）。
   */
  sessionId?: string;
}

interface Round {
  index: number;
  userMsgId: string;
  userContent: string;
  isCurrentStreaming: boolean;
  /** 此轮次跨越午夜（用户消息和 AI 回复在不同日期） */
  crossesMidnight: boolean;
}

/** 导航行：已加载轮（可点击跳转）+ 未加载轮（只有摘要，不提供点击） */
interface NavRow {
  /** 绝对轮号（1-based，相对整会话历史） */
  absIndex: number;
  /** 仅已加载轮有（点击跳转依赖它定位到虚拟列表中的消息） */
  userMsgId?: string;
  summary: string;
  fullText: string;
  loaded: boolean;
  isCurrentStreaming: boolean;
  crossesMidnight: boolean;
}

/** 行内摘要最大字符数（窄列只放得下 ~4–6 个汉字，其余由浮层给全） */
const RAIL_SUMMARY_CHARS = 24;

/** 浮层摘要最大字符数 */
const DETAIL_SUMMARY_CHARS = 120;

/**
 * 轮次导航器 — 在消息列表左侧显示对话轮次（B1，2026-10-30）。
 *
 * 形态（用户裁定「窄列 + 截断摘要」）：
 * - **常显**：进入会话即可看到有哪些轮，不再折叠成 12px 胶囊、不再依赖 hover 展开；
 * - 每行 =「轮号 + 用户问题摘要（按可用宽度截断）」——实测导航右缘 354、正文起点 398，
 *   故列宽控制在 ~68px 内，**不遮挡正文**；
 * - 完整问题用**自定义浮层**（hover/focus 时浮出），**移除原生 `title`**（不可控、不可聚焦）；
 * - 保留：点击跳转（经 `chatInspectorStore.highlightedRoundId` → 虚拟列表内部滚动）、
 *   当前轮高亮、「更早 N 轮未加载」入口、流式中/跨午夜标记；
 * - 轮数多时列表**可滚动**（原"前 3 + 当前 ±5 + 后 3 + ⋯"的窗口折叠已移除）。
 *
 * B2（2026-10-30）：**未加载轮次也有摘要** —— 一次请求取整会话按轮摘要，
 * 未加载行按绝对轮号渲染为只读行（不可点击：目标消息不在虚拟列表中，无法滚动定位）。
 */
function RoundNavigator({
  messages,
  isStreaming,
  containerRef,
  totalRounds,
  hasOlder,
  onLoadOlder,
  sessionId,
}: RoundNavigatorProps) {
  const { t } = useTranslation();
  /** 当前活跃轮的**绝对轮号**（0 = 尚未定位） */
  const [activeRound, setActiveRound] = useState<number>(0);
  /** 浮层当前展开的轮（绝对轮号；-1 = 无） */
  const [detailRound, setDetailRound] = useState<number>(-1);
  const listRef = useRef<HTMLDivElement>(null);
  /** 目标消息 id → 由持有 virtualizer 的列表内部滚动（P0-6，见 handleRoundClick 注释） */
  const setHighlightedRoundId = useChatInspectorStore(
    (s) => s.setHighlightedRoundId,
  );

  // B2：整会话按轮摘要（缓存 + 单次请求；失败 ⇒ 空数组 ⇒ 行为退回 B1）
  const remoteRounds = useSessionRoundSummaries(sessionId, totalRounds);

  // 计算轮次
  const rounds = useMemo<Round[]>(() => {
    const result: Round[] = [];
    const lastMsg = messages[messages.length - 1];
    const isLastStreaming = isStreaming && lastMsg?.role === "assistant";

    // 辅助函数：比较两个时间戳是否跨天
    const isCrossDay = (ts1: number, ts2: number): boolean => {
      try {
        const d1 = new Date(ts1);
        const d2 = new Date(ts2);
        return (
          d1.getDate() !== d2.getDate() ||
          d1.getMonth() !== d2.getMonth() ||
          d1.getFullYear() !== d2.getFullYear()
        );
      } catch {
        return false;
      }
    };

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === "user") {
        let crossesMidnight = false;

        // 查找下一个 assistant 消息，检查是否跨午夜
        for (let j = i + 1; j < messages.length; j++) {
          if (
            messages[j].role === "assistant" &&
            messages[j].timestamp &&
            msg.timestamp
          ) {
            crossesMidnight = isCrossDay(msg.timestamp, messages[j].timestamp!);
            break;
          }
        }

        result.push({
          index: result.length + 1,
          userMsgId: msg.id,
          userContent: typeof msg.content === "string" ? msg.content : "",
          isCurrentStreaming: false,
          crossesMidnight,
        });
      }
    }

    // 标记当前正在进行中的轮次
    if (result.length > 0 && isLastStreaming) {
      result[result.length - 1].isCurrentStreaming = true;
    }

    return result;
  }, [messages, isStreaming]);

  // P1-6a：总量口径 + 尾锚定。
  //  - 分页取的是**尾部一页** ⇒ 已加载的 user 消息即**最后** loadedRounds 轮；
  //  - 绝对轮号 = `absBase + round.index`（round.index 为已加载内的 1-based 序）；
  //  - effectiveTotal 兜底：后端 roundCount 缺失/落后于已加载轮数时，以已加载为准（不虚增）。
  const loadedRounds = rounds.length;
  const remoteLastIndex = remoteRounds.length
    ? remoteRounds[remoteRounds.length - 1].roundIndex
    : 0;
  const effectiveTotal = Math.max(totalRounds, loadedRounds, remoteLastIndex);
  /** 更早（未加载）的轮数 —— 仅用于展示与"尾锚定"编号，不代表可点击边界 */
  const unloadedRounds = Math.max(0, effectiveTotal - loadedRounds);

  /**
   * B2：已加载首轮的"前一轮"绝对轮号。
   *
   * 优先用远端摘要**校准**（同一 `userMsgId` 的绝对轮号）—— 这消除"总轮数估算"在
   * 尾页没有 user 消息 / roundCount 落后时的偏移；拿不到远端数据时回退到原估计。
   */
  const absBase = useMemo(() => {
    const firstId = rounds[0]?.userMsgId;
    const abs = firstId
      ? remoteRounds.find((r) => r.userMsgId === firstId)?.roundIndex
      : undefined;
    if (abs != null) return abs - 1;
    return Math.max(0, effectiveTotal - loadedRounds);
  }, [rounds, remoteRounds, effectiveTotal, loadedRounds]);

  /** 导航行 = 未加载轮（远端摘要，只读）+ 已加载轮（可点击） */
  const rows = useMemo<NavRow[]>(() => {
    const loadedIds = new Set(rounds.map((r) => r.userMsgId));
    const firstAbs = absBase + 1;
    const earlier = remoteRounds
      .filter((r) => r.roundIndex < firstAbs && !loadedIds.has(r.userMsgId))
      .map<NavRow>((r) => ({
        absIndex: r.roundIndex,
        summary:
          summarizeRoundText(r.userMsg, RAIL_SUMMARY_CHARS) ||
          t("chatInspector.userMessageFallback"),
        fullText: r.userMsg,
        loaded: false,
        isCurrentStreaming: false,
        crossesMidnight: false,
      }));
    const loaded = rounds.map<NavRow>((r, i) => ({
      absIndex: absBase + i + 1,
      userMsgId: r.userMsgId,
      summary:
        summarizeRoundText(r.userContent, RAIL_SUMMARY_CHARS) ||
        t("chatInspector.userMessageFallback"),
      fullText: r.userContent,
      loaded: true,
      isCurrentStreaming: r.isCurrentStreaming,
      crossesMidnight: r.crossesMidnight,
    }));
    return [...earlier, ...loaded];
  }, [remoteRounds, rounds, absBase, t]);

  /**
   * 点击轮次编号，滚动到该轮第一条消息
   *
   * 2026-09-27 真机排查（P0-6）：原实现用 `container.querySelector('[data-msg-id=…]')`
   * 定位消息，但消息列表是**虚拟列表**——离屏消息不在 DOM ⇒ 点击较远轮次**静默无反应**。
   * 改为复用既有范式（与 ChatMessageList 的 P1-1 修复同源）：把目标消息 id 写入
   * `chatInspectorStore.highlightedRoundId`，由**持有 virtualizer 的列表内部**用
   * `virtualizer.scrollToIndex` 滚动（离屏目标也能定位），并附带一次高亮闪烁。
   */
  const handleRoundClick = useCallback(
    (row: NavRow) => {
      if (!row.userMsgId) return;
      setHighlightedRoundId(row.userMsgId);
    },
    [setHighlightedRoundId],
  );

  /** 消息 id → 绝对轮号（避免滚动回调里对每轮各做一次 DOM 查询） */
  const roundIdxByMsgId = useMemo(() => {
    const map = new Map<string, number>();
    rounds.forEach((r, i) => map.set(r.userMsgId, absBase + i + 1));
    return map;
  }, [rounds, absBase]);

  /**
   * 滚动时更新当前活跃轮次
   *
   * 虚拟列表下只遍历**已渲染**消息（单次 querySelectorAll），按 offsetTop 取
   * 最后一条越过阈值者；无命中（视口内只有 assistant 消息）时保持上一状态，避免闪烁回第 1 轮。
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const scrollTop = container.scrollTop;
      const rendered = Array.from(
        container.querySelectorAll<HTMLElement>("[data-msg-id]"),
      );
      let best = -1;
      for (const el of rendered) {
        const id = el.getAttribute("data-msg-id");
        if (!id) continue;
        const idx = roundIdxByMsgId.get(id);
        if (idx === undefined) continue;
        if (el.offsetTop <= scrollTop + 120 && idx > best) best = idx;
      }
      if (best >= 0) setActiveRound(best);
    };

    // 初始计算
    handleScroll();

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [containerRef, roundIdxByMsgId]);

  /** B1：当前轮自动滚入窄列视野（轮数多时可滚动，不必手动找） */
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      '[data-round-active="true"]',
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeRound, rows.length]);

  // P1-6a：渲染门槛改用**总量**口径 —— 尾页无 user 消息（loadedRounds = 0）时不再整体消失，
  // 改为渲染「更早 N 轮未加载」入口；否则长会话用户永远看不到导航器。
  if (rows.length <= 1) {
    return null;
  }

  return (
    <div className="absolute left-0 top-0 bottom-0 z-10 pointer-events-none">
      {/* B1：常显窄列（轮号 + 截断摘要），不再折叠成胶囊 */}
      <div
        ref={listRef}
        className="absolute left-1 top-1/2 -translate-y-1/2 flex flex-col gap-1 bg-white/95 dark:bg-gray-800/95 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg px-1 py-2 pointer-events-auto w-[68px] max-h-[80vh] overflow-y-auto"
      >
        {/* P1-6a：更早轮次未加载入口（尾部分页下，已加载的只是最后若干轮）。
            仅在 `hasOlder`（后端确认有更早消息）时出现——避免把"总量与已加载轮数之差"
            当成"未加载轮数"而误导（该差值只在总量=用户提问轮时等价）。 */}
        {hasOlder && (
          <button
            onClick={onLoadOlder}
            className="w-5 h-4 shrink-0 rounded-full text-[8px] font-medium flex items-center justify-center bg-gray-100 dark:bg-gray-700/60 text-gray-500 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600 transition-all"
            title={
              unloadedRounds > 0
                ? t("chat.roundsUnloaded", { count: unloadedRounds })
                : t("chat.roundsUnloadedNoCount")
            }
            aria-label={t("chat.roundsUnloadedNoCount")}
          >
            {unloadedRounds > 0 ? `↑${unloadedRounds}` : "↑"}
          </button>
        )}

        {rows.map((row) => {
          const isActive = row.absIndex === activeRound;
          const isDetailOpen = detailRound === row.absIndex;
          const badgeClass = row.isCurrentStreaming
            ? "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 ring-1 ring-blue-300 dark:ring-blue-700"
            : row.crossesMidnight
              ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-500 dark:text-indigo-400"
              : isActive
                ? "bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 scale-110"
                : row.loaded
                  ? "bg-gray-200 dark:bg-gray-700/60 text-gray-500 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500";
          const badgeContent = row.isCurrentStreaming ? (
            <span className="text-[7px]">⏳</span>
          ) : (
            <span className="relative">
              {row.absIndex}
              {row.crossesMidnight && (
                <span className="absolute -top-1 -right-1 text-[7px] leading-none">
                  🌙
                </span>
              )}
            </span>
          );
          const badgeBase =
            "w-4 h-4 shrink-0 rounded-full text-[9px] font-medium flex items-center justify-center transition-all duration-200";

          return (
            <div
              key={row.absIndex}
              data-round-active={isActive ? "true" : undefined}
              data-round-unloaded={row.loaded ? undefined : "true"}
              className="relative flex items-center gap-1 shrink-0"
              onMouseEnter={() => setDetailRound(row.absIndex)}
              onMouseLeave={() => setDetailRound(-1)}
            >
              {row.loaded ? (
                <button
                  onClick={() => handleRoundClick(row)}
                  onFocus={() => setDetailRound(row.absIndex)}
                  onBlur={() => setDetailRound(-1)}
                  aria-label={t("chat.roundNavRoundAria", {
                    count: row.absIndex,
                  })}
                  className={`${badgeBase} cursor-pointer border-0 ${badgeClass} ${
                    row.isCurrentStreaming ? "animate-pulse" : ""
                  }`}
                >
                  {badgeContent}
                </button>
              ) : (
                // B2：未加载轮 —— 只有摘要，消息不在虚拟列表中 ⇒ 不提供点击（点击无法定位）
                <span
                  aria-label={t("chat.roundNavRoundUnloadedAria", {
                    count: row.absIndex,
                  })}
                  data-round-id={row.absIndex}
                  className={`${badgeBase} ${badgeClass}`}
                >
                  {badgeContent}
                </span>
              )}

              {/* B1：行内截断摘要（常显，不需要 hover） */}
              <span className="min-w-0 flex-1 truncate text-[9px] leading-none text-gray-500 dark:text-gray-400 select-none">
                {row.summary}
              </span>

              {/* B1：完整问题浮层（替代原生 title；只在 hover/focus 时出现） */}
              {isDetailOpen && row.fullText.trim().length > 0 && (
                <div className="absolute left-full ml-1 top-1/2 -translate-y-1/2 w-56 px-2 py-1 bg-gray-800 dark:bg-gray-700 text-white text-[10px] leading-snug rounded shadow-lg whitespace-normal break-words pointer-events-none z-20">
                  {summarizeRoundText(row.fullText, DETAIL_SUMMARY_CHARS)}
                  <div className="absolute left-[-3px] top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-gray-800 dark:bg-gray-700 rotate-45" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default RoundNavigator;
