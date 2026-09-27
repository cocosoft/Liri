import { useMemo, useCallback, useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Message } from "../../types";
import { useChatInspectorStore } from "../../stores/chatInspectorStore";

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

// ── 折叠模式常量 ──────────────────────────────────────────────────

/** 当前轮前后各显示的轮数 */
const NAV_WINDOW = 5;

/** 顶部固定显示的轮数 */
const HEAD_PINNED = 3;

/** 底部固定显示的轮数 */
const TAIL_PINNED = 3;

/** 超过此轮数启用折叠模式 */
const COLLAPSE_THRESHOLD = HEAD_PINNED + TAIL_PINNED + NAV_WINDOW * 2 + 2;

// ── 工具类型 ─────────────────────────────────────────────────────

/** 渲染项：轮次或省略号 */
type RenderItem =
  { type: "round"; round: Round } | { type: "ellipsis"; key: string };

/**
 * 计算需要渲染的轮次列表（含省略号占位）
 *
 * 当轮数超过 COLLAPSE_THRESHOLD 时：
 * 1. 始终显示前 HEAD_PINNED 轮
 * 2. 始终显示当前轮前后各 NAV_WINDOW 轮
 * 3. 始终显示后 TAIL_PINNED 轮
 * 4. 中间断开处用「···」省略
 *
 * 当前轮靠近首部或尾部时，各区段可能重叠，自动去掉多余的省略号。
 */
function computeRenderItems(
  rounds: Round[],
  activeRound: number,
): RenderItem[] {
  if (rounds.length <= COLLAPSE_THRESHOLD) {
    // 轮数少，全部显示
    return rounds.map((r) => ({ type: "round" as const, round: r }));
  }

  const last = rounds.length - 1;
  const headEnd = Math.min(HEAD_PINNED - 1, last);
  const windowStart = Math.max(0, activeRound - NAV_WINDOW);
  const windowEnd = Math.min(last, activeRound + NAV_WINDOW);
  const tailStart = Math.max(0, last - TAIL_PINNED + 1);

  // 收集需要显示的索引区间
  const visibleSet = new Set<number>();

  // 头部区间
  for (let i = 0; i <= headEnd; i++) visibleSet.add(i);

  // 当前轮窗口区间
  for (let i = windowStart; i <= windowEnd; i++) visibleSet.add(i);

  // 尾部区间
  for (let i = tailStart; i <= last; i++) visibleSet.add(i);

  // 排序并判断断点
  const sorted = [...visibleSet].sort((a, b) => a - b);
  const result: RenderItem[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const idx = sorted[i];
    result.push({ type: "round", round: rounds[idx] });

    // 如果当前项与下一项不连续（有间隔），插入省略号
    const nextIdx = sorted[i + 1];
    if (nextIdx !== undefined && nextIdx - idx > 1) {
      result.push({ type: "ellipsis", key: `ellipsis-${idx}-${nextIdx}` });
    }
  }

  return result;
}

/**
 * 轮次导航器 — 在消息列表右侧显示对话轮次标记
 *
 * 将 messages 按 role: "user" 分组为多轮对话，每轮用一个灰色数字标记。
 * 点击跳转到该轮第一条用户消息；hover 显示轮摘要（前 20 字）。
 * 仅多于 1 轮时显示。
 *
 * 当轮数较多（超过 16 轮）时自动启用**折叠模式**：
 * - 头部固定显示前 3 轮
 * - 当前轮前后各显示 5 轮
 * - 尾部固定显示后 3 轮
 * - 断开处以「···」连接，高度不随轮数增长
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
  const [hoveredRound, setHoveredRound] = useState<number>(-1);
  /** 是否展开为完整轮次列表（默认折叠为小圆点） */
  const [expanded, setExpanded] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);
  /** 目标消息 id → 由持有 virtualizer 的列表内部滚动（P0-6，见 handleRoundClick 注释） */
  const setHighlightedRoundId = useChatInspectorStore(
    (s) => s.setHighlightedRoundId,
  );

  // 点击外部自动折叠
  useEffect(() => {
    if (!expanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [expanded]);

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

  // 计算需要渲染的项（含折叠）
  const renderItems = useMemo<RenderItem[]>(
    () => computeRenderItems(rounds, activeRound),
    [rounds, activeRound],
  );

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

  // P1-6a：渲染门槛改用**总量**口径 —— 尾页无 user 消息（loadedRounds = 0）时不再整体消失，
  // 改为渲染「更早 N 轮未加载」入口；否则长会话用户永远看不到导航器。
  if (effectiveTotal <= 1) {
    return null;
  }

  return (
    <div
      ref={navRef}
      className="absolute left-0 top-0 bottom-0 z-10 pointer-events-none"
    >
      {/* 折叠模式：左侧边缘小圆点 */}
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          onMouseEnter={() => setExpanded(true)}
          className="absolute left-1 top-1/2 -translate-y-1/2 w-3 h-12 rounded-full bg-gray-300/60 dark:bg-gray-600/60 hover:bg-gray-400/80 dark:hover:bg-gray-500/80 transition-all duration-200 cursor-pointer pointer-events-auto flex items-center justify-center group"
          title={t("chat.roundNavExpand", { count: effectiveTotal })}
          aria-label={t("chat.roundNavExpandAria", { count: effectiveTotal })}
        >
          <span className="text-[8px] text-gray-500 dark:text-gray-400 font-bold opacity-0 group-hover:opacity-100 transition-opacity">
            {effectiveTotal}
          </span>
        </button>
      )}

      {/* 展开模式：完整轮次列表 */}
      {expanded && (
        <div className="absolute left-1 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5 bg-white/95 dark:bg-gray-800/95 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg px-1 py-2 pointer-events-auto max-h-[80vh] overflow-y-auto">
          {/* 折叠按钮 */}
          <button
            onClick={() => setExpanded(false)}
            className="w-4 h-4 flex items-center justify-center text-[8px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors mb-0.5"
            title={t("chat.roundNavCollapse")}
            aria-label={t("chat.roundNavCollapse")}
          >
            ◀
          </button>

          {/* P1-6a：更早轮次未加载入口（尾部分页下，已加载的只是最后若干轮）。
              仅在 `hasOlder`（后端确认有更早消息）时出现——避免把"总量与已加载轮数之差"
              当成"未加载轮数"而误导（该差值只在总量=用户提问轮时等价）。 */}
          {hasOlder && (
            <>
              <button
                onClick={onLoadOlder}
                className="w-5 h-4 rounded-full text-[8px] font-medium flex items-center justify-center bg-gray-100 dark:bg-gray-700/60 text-gray-500 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600 transition-all"
                title={
                  unloadedRounds > 0
                    ? t("chat.roundsUnloaded", { count: unloadedRounds })
                    : t("chat.roundsUnloadedNoCount")
                }
                aria-label={t("chat.roundsUnloadedNoCount")}
              >
                {unloadedRounds > 0 ? `↑${unloadedRounds}` : "↑"}
              </button>
              <div className="w-4 h-3 flex items-center justify-center">
                <span className="text-[9px] font-bold text-gray-400 dark:text-gray-500 leading-none">
                  ⋯
                </span>
              </div>
            </>
          )}

          {renderItems.map((item) => {
            if (item.type === "ellipsis") {
              return (
                <div
                  key={item.key}
                  className="w-4 h-3 flex items-center justify-center"
                >
                  <span className="text-[9px] font-bold text-gray-400 dark:text-gray-500 leading-none">
                    ⋯
                  </span>
                </div>
              );
            }

            const round = item.round;
            const idx = round.index - 1;
            const isActive = idx === activeRound;
            const isHovered = hoveredRound === idx;

            return (
              <div key={round.index} className="relative">
                <button
                  onClick={() => handleRoundClick(round)}
                  onMouseEnter={() => setHoveredRound(idx)}
                  onMouseLeave={() => setHoveredRound(-1)}
                  aria-label={t("chat.roundNavRoundAria", {
                    count: unloadedRounds + round.index,
                  })}
                  className={`
                    w-4 h-4 rounded-full text-[9px] font-medium
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
                  title={
                    (round.crossesMidnight ? "🌙 " : "") +
                    round.userContent.slice(0, 20) +
                    (round.userContent.length > 20 ? "..." : "")
                  }
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

                {/* 悬停提示弹窗 */}
                {isHovered && (
                  <div className="absolute left-6 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-800 dark:bg-gray-700 text-white text-[10px] rounded shadow-lg whitespace-nowrap pointer-events-none z-20">
                    {round.userContent.slice(0, 18)}
                    {round.userContent.length > 18 ? "..." : ""}
                    <div className="absolute left-[-3px] top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-gray-800 dark:bg-gray-700 rotate-45" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default RoundNavigator;
