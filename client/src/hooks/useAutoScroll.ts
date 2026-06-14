import { useRef, useEffect, useCallback } from "react";

/**
 * 聊天区域自动滚动 Hook
 * 仅在用户处于底部附近时自动跟随新消息，避免干扰用户阅读历史消息
 */
export function useAutoScroll(deps: {
  messageCount: number;
  isStreaming: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const prevMessageCountRef = useRef(0);
  const isNearBottomRef = useRef(true);

  /** 检测容器是否在底部附近（阈值 100px） */
  const checkNearBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return true;
    return (
      container.scrollHeight - container.scrollTop - container.clientHeight < 100
    );
  }, []);

  /** 滚动到底部 */
  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, []);

  // 监听滚动事件，记录用户位置
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      isNearBottomRef.current = checkNearBottom();
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
    };
  }, [checkNearBottom]);

  // 消息数量变化时自动滚动
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = deps.messageCount;

    if (deps.messageCount > prevCount && isNearBottomRef.current) {
      scrollToBottom();
    }
  }, [deps.messageCount, scrollToBottom]);

  // 流式输出期间：ResizeObserver 监听尺寸变化，仅在内容增长时滚动
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

  return { containerRef, scrollToBottom };
}