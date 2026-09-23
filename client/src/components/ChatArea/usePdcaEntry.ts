import { useOrchestrationStore } from "@/stores/orchestrationStore";
import { useSessionStore } from "@/stores/sessionStore";
import {
  PROGRESS_EVENT_TYPES,
  AUTO_LAUNCHED_TYPE,
  findLatestEvent,
} from "./PdcaActivityStrip";

/**
 * UI 期 UI-2（2026-09-23 修复计划 §十）：PDCA 编排入口的**共享判定**。
 *
 * 由浮动栏 `StatusFloatBar`（徽标可见性/点击）与 `ChatPdcaDrawer`（展开面板 taskId）
 * 共用**同一份**判据 —— 沿用这两个组件既有约定（`ChatPdcaDrawer` 头部注释自述
 * "与 PdcaActivityStrip 共用 findLatestEvent / 事件类型白名单，避免逻辑漂移"）。
 *
 * 数据源仅 orchestrationStore + sessionStore（纯读真实 store）；无匹配即 `visible=false`。
 */
export function usePdcaEntry(): { visible: boolean; taskId?: string } {
  const timeline = useOrchestrationStore((s) => s.timeline);
  const latest = useOrchestrationStore((s) => s.latest);
  const currentSessionId = useSessionStore((s) => s.currentSession?.id);

  const ev = currentSessionId
    ? findLatestEvent(timeline, latest, currentSessionId, [
        ...PROGRESS_EVENT_TYPES,
        AUTO_LAUNCHED_TYPE,
      ])
    : null;

  return {
    visible: !!ev,
    taskId: ev?.taskId ?? ev?.planId ?? undefined,
  };
}
