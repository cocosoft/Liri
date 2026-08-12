import { useState, useCallback, useRef, useEffect } from "react";

/**
 * useChatDraft — 聊天输入框草稿持久化 hook
 *
 * 将会话输入内容按 sessionId 存入 localStorage，切换会话时自动恢复。
 * 防抖 300ms 写入，避免频繁 IO。
 */
export function useChatDraft(sessionId?: string) {
  const [input, setInput] = useState("");
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 草稿持久化键名（按会话 ID 区分） */
  const getDraftKey = useCallback(
    (sid?: string): string => `chat_draft_${sid || "default"}`,
    [],
  );

  /** 从 localStorage 恢复草稿 */
  useEffect(() => {
    const key = getDraftKey(sessionId);
    try {
      const saved = localStorage.getItem(key);
      // 无论是否有草稿都重置 input——否则切到无草稿会话时残留上一会话文本
      setInput(saved ?? "");
    } catch {
      setInput("");
    }
  }, [sessionId, getDraftKey]);

  /** 将当前输入内容持久化到 localStorage */
  const saveDraft = useCallback(
    (value: string) => {
      const key = getDraftKey(sessionId);
      try {
        if (value.trim()) {
          localStorage.setItem(key, value);
        } else {
          localStorage.removeItem(key);
        }
      } catch {
        // localStorage 不可用时静默忽略
      }
    },
    [sessionId, getDraftKey],
  );

  /** 清除当前会话的草稿 */
  const clearDraft = useCallback(() => {
    const key = getDraftKey(sessionId);
    try {
      localStorage.removeItem(key);
    } catch {
      // 静默忽略
    }
  }, [sessionId, getDraftKey]);

  /** 带防抖的草稿持久化（输入变化时调用） */
  const persistDraft = useCallback(
    (value: string) => {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
      }
      draftTimerRef.current = setTimeout(() => saveDraft(value), 300);
    },
    [saveDraft],
  );

  /** 更新 input 的同时触发草稿持久化 */
  const setInputWithDraft = useCallback(
    (value: string) => {
      setInput(value);
      persistDraft(value);
    },
    [persistDraft],
  );

  return {
    input,
    setInput,
    setInputWithDraft,
    clearDraft,
    saveDraft,
  };
}
