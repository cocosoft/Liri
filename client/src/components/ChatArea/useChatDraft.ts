import { useState, useCallback, useRef, useEffect } from "react";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:chat:draft");

/**
 * useChatDraft — 聊天输入框草稿持久化 hook
 *
 * 将会话输入内容按 sessionId 存入 localStorage，切换会话时自动恢复。
 * 防抖 300ms 写入，避免频繁 IO。
 */
export function useChatDraft(sessionId?: string) {
  const [input, setInput] = useState("");
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // R2 修复：实时跟踪最新输入（cleanup 中 flush 防抖草稿需要读取最新值）
  const inputRef = useRef("");
  useEffect(() => {
    inputRef.current = input;
  }, [input]);

  /** 草稿持久化键名（按会话 ID 区分，统一 liri- 命名空间） */
  const getDraftKey = useCallback(
    (sid?: string): string => `liri-chat-draft-${sid || "default"}`,
    [],
  );

  /** 从 localStorage 恢复草稿 */
  useEffect(() => {
    const key = getDraftKey(sessionId);
    try {
      const saved = localStorage.getItem(key);
      // 无论是否有草稿都重置 input——否则切到无草稿会话时残留上一会话文本
      setInput(saved ?? "");
      // 竞态排查：会话切换恢复点——记录目标会话与恢复结果（有/无草稿）
      logger.info("draft:restore", {
        sessionId: sessionId || "default",
        hasDraft: saved !== null,
        draftLength: saved?.length ?? 0,
      });
    } catch {
      setInput("");
    }

    // R2 修复：切换会话（或卸载）时先同步 flush 本会话未落盘的防抖草稿。
    // 原实现不 flush，切到新会话后 300ms 内的输入会 clearTimeout 掉
    // 旧会话定时器，旧会话草稿永久丢失。cleanup 闭包捕获旧会话 key。
    return () => {
      if (draftTimerRef.current) {
        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
        const pending = inputRef.current;
        try {
          if (pending.trim()) {
            localStorage.setItem(key, pending);
            // 竞态排查：切换时 flush 未落盘草稿——若此处未触发且草稿丢失，
            // 检查是否 persistDraft 在 cleanup 之后才被调度
            logger.info("draft:flushOnSwitch", {
              sessionId: sessionId || "default",
              key,
              pendingLength: pending.length,
              action: "set",
            });
          } else {
            localStorage.removeItem(key);
            logger.info("draft:flushOnSwitch", {
              sessionId: sessionId || "default",
              key,
              pendingLength: 0,
              action: "remove",
            });
          }
        } catch {
          // localStorage 不可用时静默忽略
        }
      }
    };
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
