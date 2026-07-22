import { useMemo, useCallback, useEffect, useState, useRef } from "react";
import type { Message } from "../../types";

interface RoundNavigatorProps {
  messages: Message[];
  isStreaming: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
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
}: RoundNavigatorProps) {
  const [activeRound, setActiveRound] = useState<number>(0);
  const [hoveredRound, setHoveredRound] = useState<number>(-1);
  /** 是否展开为完整轮次列表（默认折叠为小圆点） */
  const [expanded, setExpanded] = useState(false);
  const navRef = useRef<HTMLDivElement>(null);

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

  // 计算需要渲染的项（含折叠）
  const renderItems = useMemo<RenderItem[]>(
    () => computeRenderItems(rounds, activeRound),
    [rounds, activeRound],
  );

  /**
   * 点击轮次编号，滚动到该轮第一条消息
   */
  const handleRoundClick = useCallback(
    (round: Round) => {
      const container = containerRef.current;
      if (!container) return;

      const msgEl = container.querySelector(
        `[data-msg-id="${round.userMsgId}"]`,
      );
      if (msgEl) {
        msgEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [containerRef],
  );

  /**
   * 滚动时更新当前活跃轮次
   */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const scrollTop = container.scrollTop;
      let activeIdx = rounds.length - 1;

      for (let i = rounds.length - 1; i >= 0; i--) {
        const msgEl = container.querySelector(
          `[data-msg-id="${rounds[i].userMsgId}"]`,
        );
        if (msgEl && (msgEl as HTMLElement).offsetTop <= scrollTop + 120) {
          activeIdx = i;
          break;
        }
      }

      setActiveRound(activeIdx);
    };

    // 初始计算
    handleScroll();

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [containerRef, rounds]);

  // 仅多于 1 轮时渲染（必须放在所有 hooks 之后）
  if (rounds.length <= 1) {
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
          title={`${rounds.length} 轮对话 · 点击展开导航`}
          aria-label={`${rounds.length} 轮对话，点击展开轮次导航`}
        >
          <span className="text-[8px] text-gray-500 dark:text-gray-400 font-bold opacity-0 group-hover:opacity-100 transition-opacity">
            {rounds.length}
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
            title="折叠导航"
          >
            ◀
          </button>

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
                      {round.index}
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
