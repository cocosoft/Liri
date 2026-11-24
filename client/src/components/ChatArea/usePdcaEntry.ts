import { useOrchestrationStore } from "@/stores/orchestrationStore";
import { useSessionStore } from "@/stores/sessionStore";
import { resolvePdcaEntry } from "./PdcaActivityStrip";

/**
 * UI 期 UI-2（2026-09-23）修复计划 §十：PDCA 编排入口的**共享判定**。
 *
 * 由浮动栏 `StatusFloatBar`（徽标可见性/点击）与 `ChatPdcaDrawer`（展开面板 taskId）
 * 共用**同一份**判据 —— 判据本体收敛在 `resolvePdcaEntry`（纯函数，可单测），
 * 避免"组件里各写一份"的漂移。
 *
 * 批次 14（P2-A）：判据拆成 `active`（进行中 ⇒ 徽标常驻）与 `available`（有 PDCA
 * 可看，含终态 ⇒ 抽屉可渲染），同一事件源派生，不新增第二份匹配逻辑。
 *
 * 数据源仅 orchestrationStore + sessionStore（纯读真实 store）；无匹配即双 false。
 */
export function usePdcaEntry(): {
  active: boolean;
  available: boolean;
  taskId?: string;
} {
  const timeline = useOrchestrationStore((s) => s.timeline);
  const latest = useOrchestrationStore((s) => s.latest);
  const currentSessionId = useSessionStore((s) => s.currentSession?.id);

  return resolvePdcaEntry(timeline, latest, currentSessionId);
}
