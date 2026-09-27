import { useRef, useEffect, useCallback, useState } from "react";
import { createLogger } from "@/utils/logger";

const logger = createLogger("hooks:useAutoScroll");

/**
 * 聊天区域自动滚动 Hook（**只负责"跟随"与按钮态**）
 *
 * 职责边界（P1-17，2026-09-27，D5=B 修订）：
 *  - 本 hook 处理：用户是否上滑（`isUserScrolledUp`）、"回到底部"按钮显隐、消息增长/流式时的**跟随贴底**。
 *  - 本 hook **不再**处理"会话切换后的位置恢复"：虚拟列表的 `scrollHeight` 只反映**已测量**项，
 *    用像素偏移恢复会被 clamp 并提前判稳（实测：切回长会话停在 0 或旧布局上限 ~1500，2/2 复现；
 *    整页重载也可能停在会话中部）。该职责已下沉到持有 virtualizer 的 `ChatMessageList`，
 *    以**消息索引锚点**恢复（与轮次导航同一范式）。
 *
 * 数据源：仅 DOM 滚动容器（`containerRef` / `contentRef`），无 store 依赖。
 */
export function useAutoScroll(deps: {
  messageCount: number;
  isStreaming: boolean;
  sessionId?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const prevMessageCountRef = useRef(0);
  const isNearBottomRef = useRef(true);

  /** 用户是否上滑离开底部（控制"回到底部"按钮显隐） */
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);

  /** P0-5 修复：showScrollButton 替代 distanceFromBottom 阈值判断
   *  原因：scroll 事件每次都 setDistanceFromBottom 导致 ChatArea 整树重渲染，
   *  而 distanceFromBottom 唯一用途是 `> 200` 判断，改为离散布尔即可。
   */
  const [showScrollButton, setShowScrollButton] = useState(false);
  /** 上一次 showScrollButton 的值，用于跨过阈值才 setState */
  const prevShowButtonRef = useRef(false);

  /** 只读会话 id（仅用于日志；用 ref 避免 effect 依赖抖动） */
  const sessionIdRef = useRef<string | undefined>(deps.sessionId);
  sessionIdRef.current = deps.sessionId;

  /** 滚动到底部（behavior 参数：流式高频场景传 "auto" 避免 smooth 追帧抖动） */
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior });
  }, []);

  /** 按真实 distance 同步"上滑/回到底部按钮"状态 */
  const syncScrollState = useCallback((distance: number) => {
    isNearBottomRef.current = distance < 100;
    setIsUserScrolledUp(distance >= 100);
    const shouldShowButton = distance > 200;
    if (shouldShowButton !== prevShowButtonRef.current) {
      prevShowButtonRef.current = shouldShowButton;
      setShowScrollButton(shouldShowButton);
      // P0-5 日志：阈值跨越边界记录（排查 button 显隐抖动/丢失）
      logger.debug("[P0-5:useAutoScroll] showScrollButton 跨越", {
        shouldShowButton,
        distance,
        sessionId: sessionIdRef.current,
      });
    }
  }, []);

  // 监听滚动事件，统一跟踪用户位置
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      syncScrollState(
        container.scrollHeight - container.scrollTop - container.clientHeight,
      );
    };

    container.addEventListener("scroll", handleScroll, { passive: true });

    // 初始化时检测一次
    handleScroll();

    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [syncScrollState]);

  // 消息数量变化时自动滚动（仅在用户处于底部附近时）
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = deps.messageCount;

    if (deps.messageCount > prevCount) {
      if (isNearBottomRef.current) {
        scrollToBottom("auto");
      } else {
        // 消息增加但不跟随（用户在上方阅读）⇒ 同步按钮状态，保证"回到底部"入口出现
        const container = containerRef.current;
        if (container) {
          syncScrollState(
            container.scrollHeight -
              container.scrollTop -
              container.clientHeight,
          );
        }
      }
    }
  }, [deps.messageCount, scrollToBottom, syncScrollState]);

  // 流式输出期间：ResizeObserver 监听内容区尺寸变化（而非滚动容器），仅在用户在底部时滚动
  useEffect(() => {
    if (!deps.isStreaming) return;

    const content = contentRef.current;
    if (!content) return;

    let rafPending = false;
    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current && !rafPending) {
        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          // AB-24：流式高频调用用 "auto"，smooth 追帧会不断打断重开导致抖动
          scrollToBottom("auto");
        });
      }
    });

    observer.observe(content);

    return () => {
      observer.disconnect();
    };
  }, [deps.isStreaming, scrollToBottom]);

  return {
    containerRef,
    contentRef,
    isUserScrolledUp,
    scrollToBottom,
    /** P0-5 修复：离散布尔替代连续 distanceFromBottom，避免每次滚动都触发 ChatArea 重渲染 */
    showScrollButton,
  };
}
