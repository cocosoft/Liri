/**
 * useCompilePhaseStream — 知识编译阶段流（方案 B v7）
 *
 * 数据源规则（G26）：
 * - `phases[]` 的唯一来源 = SSE `knowledge:compile:phase` 与轮询 `getCompileStatus()`
 * - 旧 4 事件（started/progress/completed/aborted）只作**终态信号**，不得写入 phases
 *   （否则旧事件无 phases 字段，会与全量快照互相覆盖 → 阶段回退）
 *
 * 去重规则（G24）：同 sessionId 内 `seq` 单调递增；sessionId 变化时无条件接受并重置本地 seq。
 * 兜底：进入 compiling 后若 SSE 静默超过 5s，降级为 1s 轮询。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { knowledgeService } from "../../../services/knowledgeService";
import type { CompileProgressStatus } from "../../../services/knowledgeService";
import { sseService } from "../../../services/sseService";
import { POLL_INTERVAL } from "../useCompilePolling";

/** SSE 静默阈值：超过则降级轮询（与后端 500ms 节流窗口拉开量级） */
const SSE_SILENCE_MS = 5000;

export function useCompilePhaseStream(): {
  progress: CompileProgressStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
} {
  const [progress, setProgress] = useState<CompileProgressStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const lastSeqRef = useRef<{ sessionId: number; seq: number }>({
    sessionId: -1,
    seq: -1,
  });
  const lastEventAtRef = useRef<number>(0);

  const applySnapshot = useCallback((snap: CompileProgressStatus) => {
    const last = lastSeqRef.current;
    if (snap.sessionId === last.sessionId && snap.seq <= last.seq) return;
    lastSeqRef.current = { sessionId: snap.sessionId, seq: snap.seq };
    setProgress(snap);
  }, []);

  const refresh = useCallback(async () => {
    const snap = await knowledgeService.getCompileStatus();
    applySnapshot(snap);
  }, [applySnapshot]);

  // 主通道：SSE 阶段事件 + 终态信号
  useEffect(() => {
    sseService.on("knowledge:compile:phase", (data) => {
      lastEventAtRef.current = Date.now();
      applySnapshot(data as unknown as CompileProgressStatus);
    });
    // 终态只触发一次刷新，不直接写 phases（G26）
    const onTerminal = () => {
      void refresh();
    };
    sseService.on("knowledge:compile:started", onTerminal);
    sseService.on("knowledge:compile:completed", onTerminal);
    sseService.on("knowledge:compile:aborted", onTerminal);

    void refresh().finally(() => setLoading(false));
  }, [applySnapshot, refresh]);

  // 兜底：仅在 compiling 期间、且 SSE 静默超阈值时轮询
  useEffect(() => {
    if (progress?.status !== "compiling") return;
    const timer = setInterval(() => {
      if (Date.now() - lastEventAtRef.current > SSE_SILENCE_MS) {
        void refresh();
      }
    }, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [progress?.status, refresh]);

  return { progress, loading, refresh };
}
