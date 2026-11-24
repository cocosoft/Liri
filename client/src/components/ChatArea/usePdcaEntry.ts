import { useEffect, useState } from "react";
import { useOrchestrationStore } from "@/stores/orchestrationStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useChatStore } from "@/stores/chat";
import { pdcaService } from "@/services/planService";
import { resolvePdcaEntry } from "./PdcaActivityStrip";

/** 当前会话消息里是否已有持久化的 PDCA 卡片（刷新后事件流为空时的"有 PDCA 可看"证据） */
function hasPdcaWorkflowCard(
  messages: { blocks?: { type: string }[] }[],
): boolean {
  return messages.some((m) =>
    (m.blocks ?? []).some((b) => b.type === "pdca_workflow"),
  );
}

/**
 * UI 期 UI-2（2026-09-23）修复计划 §十：PDCA 编排入口的**共享判定**。
 *
 * 由浮动栏 `StatusFloatBar`（徽标可见性/点击）与 `ChatPdcaDrawer`（展开面板 taskId）
 * 共用**同一份**判据 —— 判据本体收敛在 `resolvePdcaEntry`（纯函数，可单测），
 * 避免"组件里各写一份"的漂移。
 *
 * 批次 14：判据拆成 `active`（进行中 ⇒ 徽标常驻）与 `available`（有 PDCA 可看
 * ⇒ 抽屉可渲染），同一事件源派生，不新增第二份匹配逻辑。
 *
 * **P2-D（2026-11-24）**：`available` 增加"消息里有持久化卡片"这一来源；此时若实时
 * 事件没给 taskId（刷新后事件流为空），按会话向后端取**最近一条真实任务**作为兜底
 * —— 否则消息卡的「查看详情」会变成点不动的死按钮。
 */
export function usePdcaEntry(): {
  active: boolean;
  available: boolean;
  taskId?: string;
} {
  const timeline = useOrchestrationStore((s) => s.timeline);
  const latest = useOrchestrationStore((s) => s.latest);
  const currentSessionId = useSessionStore((s) => s.currentSession?.id);
  // selector 返回 boolean（稳定）⇒ 流式 chunk 不会造成额外重渲染
  const hasPersistedCard = useChatStore((s) => hasPdcaWorkflowCard(s.messages));

  const entry = resolvePdcaEntry(
    timeline,
    latest,
    currentSessionId,
    hasPersistedCard,
  );
  const [fallbackTaskId, setFallbackTaskId] = useState<string | undefined>();

  useEffect(() => {
    // 实时事件已给 taskId（或压根没 PDCA 可看）⇒ 无需兜底
    if (!entry.available || entry.taskId || !currentSessionId) {
      setFallbackTaskId(undefined);
      return;
    }
    let cancelled = false;
    void pdcaService.latestTaskIdForSession(currentSessionId).then((id) => {
      if (!cancelled) setFallbackTaskId(id ?? undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [entry.available, entry.taskId, currentSessionId]);

  return { ...entry, taskId: entry.taskId ?? fallbackTaskId };
}
