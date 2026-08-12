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
  // R-D 修复：save/restore/debounceMs 用 ref 保存最新值，effect 不再依赖它们——
  // 调用方（如 ChatArea）传入内联 save/restore，每次渲染都是新引用；
  // 若 effect 依赖引用，组件每重渲染（流式期间极频繁）就 clearTimeout + 重设
  // 500ms 定时器，防抖永不触发，context 保存被无限推迟。
  const saveRef = useRef(config.save);
  saveRef.current = config.save;
  const restoreRef = useRef(config.restore);
  restoreRef.current = config.restore;
  const debounceMsRef = useRef(config.debounceMs ?? 500);
  debounceMsRef.current = config.debounceMs ?? 500;

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
      restoreRef.current(
        currentModuleSession.context,
        currentModuleSession.id,
      );
    }
  }, [currentModuleSession?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 保存方向：module state 变更时保存到 SessionSlice ──
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!currentModuleSession) return;

    // 防抖保存（R-D：依赖稳定，仅会话切换/重建时重设）
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const context = saveRef.current();
      if (!context) return;

      logger.debug("保存模块上下文到 SessionSlice", {
        moduleType,
        sessionId: currentModuleSession.id,
        contextKeys: Object.keys(context),
      });

      // context 已由 save() 函数保证类型（T extends Partial<SessionContext>）
      updateSessionContext(
        currentModuleSession.id,
        context as Partial<SessionContext>,
      );
    }, debounceMsRef.current);

    return () => {
      // R2 同模式修复：切换会话/卸载时先同步 flush 未触发的防抖保存，
      // 否则 500ms 窗口内变更的模块上下文随 timer 一起被 clearTimeout 丢弃。
      // cleanup 闭包捕获的是旧会话的 currentModuleSession.id，落盘到正确会话。
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        const context = saveRef.current();
        if (context) {
          // 竞态排查：切换时 flush 未触发的防抖上下文保存——若未打印且上下文丢失，
          // 说明模块状态变更未在 effect 依赖内（timer 未被重置），需检查调用方
          logger.info("contextSync:flushOnSwitch", {
            moduleType,
            sessionId: currentModuleSession.id,
            contextKeys: Object.keys(context),
          });
          updateSessionContext(
            currentModuleSession.id,
            context as Partial<SessionContext>,
          );
        }
      }
    };
  }, [currentModuleSession?.id, updateSessionContext]); // eslint-disable-line react-hooks/exhaustive-deps
}
