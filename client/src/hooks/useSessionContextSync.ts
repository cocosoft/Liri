/**
 * useSessionContextSync — 模块状态 ↔ SessionSlice 双向同步
 *
 * Phase 4: 实现 SessionHub 跨模块上下文持久化。
 *
 * 每个模块页面调用此钩子，传入 save/restore 函数，
 * 实现模块特定状态与 SessionSlice 中 SessionContext 的双向同步。
 *
 * 使用方式：
 *   useSessionContextSync("media", {
 *     save: () => ({ prompt: mediaPrompt, size: mediaSize }),
 *     restore: (ctx) => { setPrompt(ctx.prompt); setSize(ctx.size); },
 *   });
 */

import { useEffect, useRef } from "react";
import { useRootStore } from "@/stores/root-store";
import type { SessionContext } from "@/stores/root-store/types";
import { createLogger } from "@/utils/logger";

const logger = createLogger("hooks:useSessionContextSync");

/** Context 同步配置 */
export interface ContextSyncConfig<T extends Partial<SessionContext>> {
  /** 从模块 Store 提取当前状态，返回要保存的 context 片段 */
  save: () => T;
  /** 从 SessionSlice context 恢复模块 Store 状态 */
  restore: (context: SessionContext, sessionId: string) => void;
  /** 可选：防抖间隔（ms），默认 500 */
  debounceMs?: number;
}

/**
 * 模块状态 ↔ SessionSlice 双向同步钩子
 *
 * - 保存方向：当模块状态变更时（通过 save 函数返回），自动同步到 SessionSlice
 * - 恢复方向：仅在 sessionId 变化时（会话切换），从 SessionSlice 恢复模块状态
 *
 * @param moduleType - 模块类型标识（如 "chat"、"media"、"office"）
 * @param config - 同步配置（save/restore 函数 + 防抖间隔）
 */
export function useSessionContextSync<T extends Partial<SessionContext>>(
  moduleType: string,
  config: ContextSyncConfig<T>,
): void {
  const { save, restore, debounceMs = 500 } = config;

  // SessionSlice
  const sessions = useRootStore((s) => s.sessions);
  const currentSessionId = useRootStore((s) => s.currentSessionId);
  const updateSessionContext = useRootStore((s) => s.updateSessionContext);

  // 当前模块的 session（仅当 moduleType 匹配时）
  const currentModuleSession =
    currentSessionId && sessions[currentSessionId]?.moduleType === moduleType
      ? sessions[currentSessionId]
      : null;

  // ── 恢复方向：session 切换时恢复 module state ──
  const lastSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    // 仅当 session 真正切换（ID 改变）时恢复
    if (
      currentModuleSession &&
      currentModuleSession.id !== lastSessionIdRef.current
    ) {
      logger.debug("会话切换，恢复模块上下文", {
        moduleType,
        sessionId: currentModuleSession.id,
      });
      lastSessionIdRef.current = currentModuleSession.id;
      restore(currentModuleSession.context, currentModuleSession.id);
    }
  }, [currentModuleSession?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 保存方向：module state 变更时保存到 SessionSlice ──
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!currentModuleSession) return;

    // 防抖保存
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const context = save();
      if (!context) return;

      logger.debug("保存模块上下文到 SessionSlice", {
        moduleType,
        sessionId: currentModuleSession.id,
        contextKeys: Object.keys(context),
      });

      // context 已由 save() 函数保证类型（T extends Partial<SessionContext>）
      updateSessionContext(currentModuleSession.id, context as Partial<SessionContext>);
    }, debounceMs);

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [currentModuleSession?.id, save, updateSessionContext, debounceMs]); // eslint-disable-line react-hooks/exhaustive-deps
}
