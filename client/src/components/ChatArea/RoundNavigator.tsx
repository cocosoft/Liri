import { useMemo, useCallback, useEffect, useState } from "react";
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
}

/**
 * 轮次导航器 — 在消息列表右侧显示对话轮次标记
 *
 * 将 messages 按 role: "user" 分组为多轮对话，每轮用一个灰色数字标记。
 * 点击跳转到该轮第一条用户消息；hover 显示轮摘要（前 20 字）。
 * 仅多于 1 轮时显示。
 */
function RoundNavigator({ messages, isStreaming, containerRef }: RoundNavigatorProps) {
  const [activeRound, setActiveRound] = useState<number>(0);
  const [hoveredRound, setHoveredRound] = useState<number>(-1);

  // 计算轮次
  const rounds = useMemo<Round[]>(() => {
    const result: Round[] = [];
    let lastUserIdx = -1;
    const lastMsg = messages[messages.length - 1];
    const isLastStreaming = isStreaming && lastMsg?.role === "assistant";

    messages.forEach((msg) => {
      if (msg.role === "user") {
        result.push({
          index: result.length + 1,
          userMsgId: msg.id,
          userContent: msg.content,
          isCurrentStreaming: false,
        });
        lastUserIdx = result.length - 1;
      }
    });

    // 标记当前正在进行中的轮次
    if (lastUserIdx >= 0 && isLastStreaming) {
      result[lastUserIdx].isCurrentStreaming = true;
    }

    return result;
  }, [messages, isStreaming]);

  /**
   * 点击轮次编号，滚动到该轮第一条消息
   */
  const handleRoundClick = useCallback(
    (round: Round) => {
      const container = containerRef.current;
      if (!container) return;

      const msgEl = container.querySelector(`[data-msg-id="${round.userMsgId}"]`);
      if (msgEl) {
        msgEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
    [containerRef]
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
        const msgEl = container.querySelector(`[data-msg-id="${rounds[i].userMsgId}"]`);
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
    <div className="absolute right-0 top-0 bottom-0 flex flex-col items-center justify-center gap-1.5 pr-1.5 pointer-events-none z-10">
      {rounds.map((round, idx) => {
        const isActive = idx === activeRound;
        const isHovered = hoveredRound === idx;

        return (
          <div key={round.index} className="relative pointer-events-auto">
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
                    : isActive
                      ? "bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 scale-110"
                      : "bg-gray-200 dark:bg-gray-700/60 text-gray-500 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-600"
                }
                ${round.isCurrentStreaming ? "animate-pulse" : ""}
              `}
              title={round.userContent.slice(0, 20) + (round.userContent.length > 20 ? "..." : "")}
            >
              {round.isCurrentStreaming ? (
                <span className="text-[7px]">⏳</span>
              ) : (
                round.index
              )}
            </button>

            {/* 悬停提示弹窗 */}
            {isHovered && (
              <div className="absolute right-5 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-800 dark:bg-gray-700 text-white text-[10px] rounded shadow-lg whitespace-nowrap pointer-events-none">
                {round.userContent.slice(0, 18)}
                {round.userContent.length > 18 ? "..." : ""}
                <div className="absolute right-[-3px] top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-gray-800 dark:bg-gray-700 rotate-45" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default RoundNavigator;
