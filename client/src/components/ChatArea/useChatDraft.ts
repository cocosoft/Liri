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
  // P0-4 修复：内部 state setter 重命名为 setInputState，对外暴露统一走持久化的 setInput
  const [input, setInputState] = useState("");
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
      setInputState(saved ?? "");
      // 竞态排查：会话切换恢复点——记录目标会话与恢复结果（有/无草稿）
      logger.info("draft:restore", {
        sessionId: sessionId || "default",
        hasDraft: saved !== null,
        draftLength: saved?.length ?? 0,
      });
    } catch {
      setInputState("");
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
      // P0-4 日志：clearDraft 触发点（正常发送完成时调用，排查"已发送但草稿未清"残留）
      logger.debug("[P0-4:useChatDraft] clearDraft 触发", {
        sessionId: sessionId || "default",
        key,
      });
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
      draftTimerRef.current = setTimeout(() => {
        saveDraft(value);
        // P0-4 日志：防抖后实际落盘点（300ms 防抖到期触发）
        logger.debug("[P0-4:useChatDraft] persistDraft 落盘", {
          sessionId: sessionId || "default",
          valueLength: value.length,
          debounceMs: 300,
        });
      }, 300);
    },
    [saveDraft, sessionId],
  );

  /**
   * P0-4 修复：消除双轨写入。
   * 历史问题：旧版同时暴露 setInput（不持久化）和 setInputWithDraft（持久化），
   * 调用方在 slash 命令、emoji 插入、历史导航、清空等 11 处直调 setInput 绕过持久化，
   * 导致切走再切回时 localStorage 旧草稿"复活"覆盖当前输入框。
   *
   * 现在对外只暴露 setInput，内部统一走 persistDraft；
   * clearDraft 仅在 chat-store 正常发送完成时调用（已存在逻辑）。
   */
  const setInput = useCallback(
    (value: string) => {
      setInputState(value);
      persistDraft(value);
      // P0-4 日志：setInput 调用链追踪（排查草稿复活/丢失边界情况）
      // 注意：高频调用（每次按键），用 debug 级别 + 抽样记录（仅关键转折点）
      if (value === "" || value.length === 1 || value.length % 50 === 0) {
        logger.debug("[P0-4:useChatDraft] setInput 调用", {
          sessionId: sessionId || "default",
          valueLength: value.length,
          isEmpty: value === "",
          isSingleChar: value.length === 1,
          isFiftyMultiple: value.length % 50 === 0 && value.length > 0,
        });
      }
    },
    [persistDraft, sessionId],
  );

  return {
    input,
    setInput,
    clearDraft,
    saveDraft,
  };
}
