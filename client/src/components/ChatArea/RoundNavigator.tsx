import { useMemo, useCallback, useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Message } from "../../types";
import { useChatInspectorStore } from "../../stores/chatInspectorStore";
import { summarizeRoundText } from "../../utils/roundSummaries";

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
}

interface Round {
  index: number;
  userMsgId: string;
  userContent: string;
  isCurrentStreaming: boolean;
  /** 此轮次跨越午夜（用户消息和 AI 回复在不同日期） */
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
 */
function RoundNavigator({
  messages,
  isStreaming,
  containerRef,
  totalRounds,
  hasOlder,
  onLoadOlder,
}: RoundNavigatorProps) {
  const { t } = useTranslation();
  const [activeRound, setActiveRound] = useState<number>(0);
  /** 浮层当前展开的轮（-1 = 无） */
  const [detailRound, setDetailRound] = useState<number>(-1);
  const listRef = useRef<HTMLDivElement>(null);
  /** 目标消息 id → 由持有 virtualizer 的列表内部滚动（P0-6，见 handleRoundClick 注释） */
  const setHighlightedRoundId = useChatInspectorStore(
    (s) => s.setHighlightedRoundId,
  );

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
  //  - 绝对轮号 = `unloadedRounds + round.index`（round.index 为已加载内的 1-based 序）；
  //  - effectiveTotal 兜底：后端 roundCount 缺失/落后于已加载轮数时，以已加载为准（不虚增）。
  const loadedRounds = rounds.length;
  const effectiveTotal = Math.max(totalRounds, loadedRounds);
  /** 更早（未加载）的轮数 —— 仅用于展示与"尾锚定"编号，不代表可点击边界 */
  const unloadedRounds = Math.max(0, effectiveTotal - loadedRounds);

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
    (round: Round) => {
      setHighlightedRoundId(round.userMsgId);
    },
    [setHighlightedRoundId],
  );

  /** 消息 id → 轮次下标（避免滚动回调里对每轮各做一次 DOM 查询） */
  const roundIdxByMsgId = useMemo(() => {
    const map = new Map<string, number>();
    rounds.forEach((r, i) => map.set(r.userMsgId, i));
    return map;
  }, [rounds]);

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
  }, [activeRound, effectiveTotal]);

  // P1-6a：渲染门槛改用**总量**口径 —— 尾页无 user 消息（loadedRounds = 0）时不再整体消失，
  // 改为渲染「更早 N 轮未加载」入口；否则长会话用户永远看不到导航器。
  if (effectiveTotal <= 1) {
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

        {rounds.map((round) => {
          const idx = round.index - 1;
          const isActive = idx === activeRound;
          const isDetailOpen = detailRound === idx;
          const summary =
            summarizeRoundText(round.userContent, RAIL_SUMMARY_CHARS) ||
            t("chatInspector.userMessageFallback");

          return (
            <div
              key={round.index}
              data-round-active={isActive ? "true" : undefined}
              className="relative flex items-center gap-1 shrink-0"
              onMouseEnter={() => setDetailRound(idx)}
              onMouseLeave={() => setDetailRound(-1)}
            >
              <button
                onClick={() => handleRoundClick(round)}
                onFocus={() => setDetailRound(idx)}
                onBlur={() => setDetailRound(-1)}
                aria-label={t("chat.roundNavRoundAria", {
                  count: unloadedRounds + round.index,
                })}
                className={`
                  w-4 h-4 shrink-0 rounded-full text-[9px] font-medium
                  flex items-center justify-center
                  transition-all duration-200 cursor-pointer border-0
                  ${
                    round.isCurrentStreaming
                      ? "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 ring-1 ring-blue-300 dark:ring-blue-700"
                      : round.crossesMidnight
                        ? "bg-indigo-100 dark:bg-indigo-900/30 text-indigo-500 dark:text-indigo-400"
                        : isActive
                          ? "bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 scale-110"
                          : "bg-gray-200 dark:bg-gray-700/60 text-gray-500 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600"
                  }
                  ${round.isCurrentStreaming ? "animate-pulse" : ""}
                `}
              >
                {round.isCurrentStreaming ? (
                  <span className="text-[7px]">⏳</span>
                ) : (
                  <span className="relative">
                    {unloadedRounds + round.index}
                    {round.crossesMidnight && (
                      <span className="absolute -top-1 -right-1 text-[7px] leading-none">
                        🌙
                      </span>
                    )}
                  </span>
                )}
              </button>

              {/* B1：行内截断摘要（常显，不需要 hover） */}
              <span className="min-w-0 flex-1 truncate text-[9px] leading-none text-gray-500 dark:text-gray-400 select-none">
                {summary}
              </span>

              {/* B1：完整问题浮层（替代原生 title；只在 hover/focus 时出现） */}
              {isDetailOpen && round.userContent.trim().length > 0 && (
                <div className="absolute left-full ml-1 top-1/2 -translate-y-1/2 w-56 px-2 py-1 bg-gray-800 dark:bg-gray-700 text-white text-[10px] leading-snug rounded shadow-lg whitespace-normal break-words pointer-events-none z-20">
                  {summarizeRoundText(round.userContent, DETAIL_SUMMARY_CHARS)}
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
