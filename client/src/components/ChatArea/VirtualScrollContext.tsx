/**
 * P1-1 修复：虚拟列表滚动上下文
 *
 * 问题：虚拟列表下离屏消息不在 DOM 中，querySelectorAll + scrollIntoView 失效
 * 方案：通过 React Context 传递 virtualizer.scrollToIndex，替代 DOM 查询
 */

import { createContext, useContext } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";

export interface VirtualScrollContextValue {
  /** 滚动到指定消息索引（虚拟列表专用） */
  scrollToIndex: (
    index: number,
    options?: { align?: "start" | "center" | "end" },
  ) => void;
  /** 根据消息 ID 滚动（使用 Provider 内部保存的 messages 引用） */
  scrollToMessageId: (messageId: string) => void;
}

const VirtualScrollContext = createContext<VirtualScrollContextValue | null>(
  null,
);

export function VirtualScrollProvider({
  children,
  virtualizer,
  messages,
}: {
  children: React.ReactNode;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  messages: Array<{ id: string }>;
}) {
  const scrollToIndex = (
    index: number,
    options?: { align?: "start" | "center" | "end" },
  ) => {
    virtualizer.scrollToIndex(index, options);
  };

  const scrollToMessageId = (messageId: string) => {
    const index = messages.findIndex((m) => m.id === messageId);
    if (index >= 0) {
      virtualizer.scrollToIndex(index, { align: "center" });
    }
  };

  return (
    <VirtualScrollContext.Provider value={{ scrollToIndex, scrollToMessageId }}>
      {children}
    </VirtualScrollContext.Provider>
  );
}

export function useVirtualScroll(): VirtualScrollContextValue | null {
  return useContext(VirtualScrollContext);
}
