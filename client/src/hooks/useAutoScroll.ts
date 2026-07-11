import { useRef, useEffect, useCallback, useState } from "react";

/**
 * 聊天区域自动滚动 Hook
 * 仅在用户处于底部附近时自动跟随新消息，避免干扰用户阅读历史消息
 *
 * 统一管理滚动状态：isUserScrolledUp、distanceFromBottom、scrollToBottom
 * ChatArea 不再需要独立的 handleScroll 和 showScrollToBottom 状态
 *
 * @param sessionId 当前会话 ID，用于恢复/保存滚动位置
 */
export function useAutoScroll(deps: {
  messageCount: number;
  isStreaming: boolean;
  sessionId?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevMessageCountRef = useRef(0);
  const isNearBottomRef = useRef(true);

  /** 用户是否上滑离开底部（控制"回到底部"按钮显隐） */
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);

  /** 当前距离底部的像素距离（用于按钮显示阈值判断） */
  const [distanceFromBottom, setDistanceFromBottom] = useState(0);

  /** 会话切换时保存/恢复滚动位置 */
  const scrollPositionsRef = useRef<Map<string, number>>(new Map());
  const prevSessionIdRef = useRef<string | undefined>(undefined);

  /** 滚动到底部 */
  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, []);

  // 监听滚动事件，统一跟踪用户位置
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const el = container;
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const nearBottom = distance < 100;
      isNearBottomRef.current = nearBottom;
      setIsUserScrolledUp(!nearBottom);
      setDistanceFromBottom(distance);
    };

    container.addEventListener("scroll", handleScroll, { passive: true });

    // 初始化时检测一次
    handleScroll();

    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, []);

  // 会话切换时：保存旧位置 → 恢复新位置（若无 → 滚到底部）
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const prevId = prevSessionIdRef.current;
    const currentId = deps.sessionId;

    // 保存上一个会话的滚动位置
    if (prevId && prevId !== currentId) {
      scrollPositionsRef.current.set(prevId, container.scrollTop);
    }

    // 恢复当前会话的滚动位置
    if (currentId && currentId !== prevId) {
      const savedPosition = scrollPositionsRef.current.get(currentId);
      if (savedPosition != null) {
        // requestAnimationFrame 等待 DOM 渲染完成后再滚动
        requestAnimationFrame(() => {
          container.scrollTop = savedPosition;
        });
      } else {
        // 新会话：滚动到底部
        scrollToBottom();
      }
    }

    prevSessionIdRef.current = currentId;
  }, [deps.sessionId, scrollToBottom]);

  // 消息数量变化时自动滚动（仅在用户处于底部附近时）
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = deps.messageCount;

    if (deps.messageCount > prevCount && isNearBottomRef.current) {
      scrollToBottom();
    }
  }, [deps.messageCount, scrollToBottom]);

  // 流式输出期间：ResizeObserver 监听尺寸变化，仅在内容增长且用户在底部时滚动
  useEffect(() => {
    if (!deps.isStreaming) return;

    const container = containerRef.current;
    if (!container) return;

    let rafPending = false;
    const observer = new ResizeObserver(() => {
      if (isNearBottomRef.current && !rafPending) {
        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          scrollToBottom();
        });
      }
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [deps.isStreaming, scrollToBottom]);

  return { containerRef, isUserScrolledUp, scrollToBottom, distanceFromBottom };
}
