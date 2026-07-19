/**
 * useSessionBridge — 旧 sessionStore ↔ 新 SessionHub 双向同步
 *
 * 两套 Store 并行期间，将旧 sessionStore 的当前会话同步到新 root store。
 * 仅同步当前会话（不批量同步历史会话列表），避免重复创建和切换。
 *
 * Phase 4 全部迁移后，此钩子可安全移除。
 */

import { useEffect, useRef } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { useRootStore } from "@/stores/root-store";
import { createLogger } from "@/utils/logger";

const logger = createLogger("hooks:useSessionBridge");

/**
 * 订阅旧 sessionStore 的当前会话变更，同步到新 root store 的 SessionSlice。
 *
 * - 旧 session 的 currentSession 变更 → 在 root store 中创建/切换到对应 record
 * - 使用旧 session 的原始 ID 避免重复创建
 * - 抑制 auto-switch 避免 bridge 自身的批量操作触发无限循环
 */
export function useSessionBridge(): void {
  const oldCurrentSession = useSessionStore((s) => s.currentSession);
  const prevIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!oldCurrentSession) return;

    // 避免重复同步同一个 session
    if (prevIdRef.current === oldCurrentSession.id) return;
    prevIdRef.current = oldCurrentSession.id;

    const root = useRootStore.getState();
    const oldId = oldCurrentSession.id;
    const alreadyExists = root.sessions[oldId] !== undefined;

    // 创建或复用 session record（使用旧 ID 保持身份一致）
    if (!alreadyExists) {
      root.createSession("chat", oldCurrentSession.title, oldId);
      logger.debug("Bridge: 创建 SessionHub record", { id: oldId });
    }

    // 仅当不同步时才切换
    if (root.currentSessionId !== oldId) {
      root.switchSession(oldId);
    }
  }, [oldCurrentSession]);
}
