/**
 * operationProgressStore — 全局操作进度存储
 *
 * 监听 SSE 事件（dream:phase:changed / knowledge:compile:* / task:queue:progress），
 * 汇总展示所有正在进行的后台操作。
 */
import { create } from "zustand";
import { sseService } from "../services/sseService";
import type { CompilePhase } from "../services/knowledgeService";

/** 后端 `knowledge:compile:phase` 事件载荷（全量快照，G11） */
interface CompilePhaseEvent {
  sessionId: number;
  seq: number;
  phase: CompilePhase | null;
  status: string;
  label?: string;
  skipReason: string | null;
  detail: { current: number; total: number } | null;
  current: number;
  total: number;
}

const PHASE_TEXT: Record<string, string> = {
  scanning: "扫描入料",
  cleaning: "清理产物",
  compiling: "LLM 编译",
  linting: "质量检查",
  graph_extract: "图谱提取",
  record_extract: "记录抽取",
  rule_extract: "规则抽取",
  chunk_refresh: "分块刷新",
  indexing: "索引落账",
};

const SKIP_TEXT: Record<string, string> = {
  gated: "未触发",
  busy: "任务占用",
  memory: "内存水位",
  truncated: "已截断",
  empty: "无数据",
  aborted: "已中止",
};

export interface ActiveOperation {
  /** 唯一标识 */
  id: string;
  /** 显示标题 */
  label: string;
  /** 当前进度 (0-1)，无明确进度时为 undefined */
  progress?: number;
  /** 上次更新时间戳 */
  updatedAt: number;
}

interface OperationProgressState {
  /** 当前活跃的操作列表 */
  operations: ActiveOperation[];
  /** 梦境当前阶段 */
  dreamPhase: string | null;
  /** 已完成的梦境阶段 */
  dreamPhasesDone: string[];
  /** 知识编译当前阶段（方案 B v7；详细阶段快照由 useCompilePhaseStream 持有） */
  compilePhase: CompilePhase | null;
  /** 是否已注册 SSE 监听器（防止重复注册） */
  _inited: boolean;
  /** 注册事件监听 */
  _init: () => void;
}

/** 自动清理 30 秒无更新的操作 */
const STALE_TIMEOUT_MS = 30000;

export const useOperationProgressStore = create<OperationProgressState>(
  (set, get) => ({
    operations: [],
    dreamPhase: null,
    dreamPhasesDone: [],
    compilePhase: null,
    _inited: false,

    _init: () => {
      // 防止重复注册 SSE 监听器（组件反复挂载时）
      if (get()._inited) return;
      set({ _inited: true });

      // 梦境阶段变化
      sseService.on("dream:phase:changed", (data) => {
        const phase = data.phase as string;
        const label =
          phase === "gather"
            ? "收集数据"
            : phase === "analyze"
              ? "分析中"
              : phase === "write"
                ? "写入记忆"
                : phase === "index"
                  ? "刷新索引"
                  : "处理中";
        set((s) => ({
          dreamPhase: phase,
          dreamPhasesDone: [...new Set([...s.dreamPhasesDone, phase])],
          operations: upsertOp(s.operations, "dream", `🌙 梦境: ${label}`, {
            progress: (data.progress as number) ?? undefined,
          }),
        }));
      });

      sseService.on("dream:cycle:completed", (data) => {
        const status = data.status as string;
        set((s) => ({
          dreamPhase: null,
          dreamPhasesDone: [],
          operations: upsertOp(
            s.operations,
            "dream",
            `🌙 梦境${status === "completed" ? "完成" : "部分完成"}`,
            {
              progress: 1,
            },
          ),
        }));
        // 5 秒后移除
        setTimeout(() => {
          set((s) => ({
            operations: s.operations.filter((o) => o.id !== "dream"),
          }));
        }, 5000);
      });

      sseService.on("dream:cycle:failed", (_data) => {
        set((s) => ({
          dreamPhase: null,
          dreamPhasesDone: [],
          operations: upsertOp(s.operations, "dream", "🌙 梦境失败", {
            progress: 1,
          }),
        }));
        setTimeout(() => {
          set((s) => ({
            operations: s.operations.filter((o) => o.id !== "dream"),
          }));
        }, 8000);
      });

      // 知识编译
      sseService.on("knowledge:compile:started", (data) => {
        set((s) => ({
          operations: upsertOp(
            s.operations,
            "compile",
            `📚 编译知识库 (0/${data.total})`,
            {
              progress: 0,
            },
          ),
        }));
      });

      sseService.on("knowledge:compile:progress", (data) => {
        const current = data.current as number;
        const total = data.total as number;
        set((s) => ({
          operations: upsertOp(
            s.operations,
            "compile",
            `📚 编译知识库 (${current}/${total})`,
            {
              progress: total > 0 ? current / total : undefined,
            },
          ),
        }));
      });

      sseService.on("knowledge:compile:completed", (_data) => {
        set((s) => ({
          operations: upsertOp(s.operations, "compile", "📚 编译完成", {
            progress: 1,
          }),
        }));
        setTimeout(() => {
          set((s) => ({
            operations: s.operations.filter((o) => o.id !== "compile"),
          }));
        }, 5000);
      });

      sseService.on("knowledge:compile:aborted", (_data) => {
        set((s) => ({
          operations: upsertOp(s.operations, "compile", "📚 编译中止", {
            progress: 1,
          }),
        }));
        setTimeout(() => {
          set((s) => ({
            operations: s.operations.filter((o) => o.id !== "compile"),
          }));
        }, 8000);
      });

      // 知识编译阶段（方案 B v7）：载荷为 9 阶段全量快照 + seq。
      // G26：phases 的唯一来源是本事件与轮询；旧 4 事件只作终态信号，不写 phases。
      sseService.on("knowledge:compile:phase", (data) => {
        const evt = data as unknown as CompilePhaseEvent;
        const phase = evt.phase;
        const phaseText = phase ? ` · ${PHASE_TEXT[phase] ?? phase}` : "";
        const stateText =
          evt.status === "triggered"
            ? "（已触发）"
            : evt.status === "skipped" && evt.skipReason
              ? `（${SKIP_TEXT[evt.skipReason] ?? evt.skipReason}）`
              : "";
        const detailText =
          evt.detail && evt.detail.total > 0
            ? ` (${evt.detail.current}/${evt.detail.total})`
            : "";
        set((s) => ({
          compilePhase: phase,
          operations: upsertOp(
            s.operations,
            "compile",
            `📚 编译知识库${phaseText}${stateText}${detailText}`,
            {
              progress:
                evt.total > 0
                  ? Math.min(0.99, evt.current / evt.total)
                  : undefined,
            },
          ),
        }));
      });

      // 任务队列
      sseService.on("task:queue:progress", (data) => {
        const state = data.state as {
          total: number;
          done: number;
          failed: number;
          pending: number;
          running: number;
        };
        const queueId = data.queueId as string;
        const total = state.total;
        const completed = state.done + state.failed;
        set((s) => ({
          operations: upsertOp(
            s.operations,
            `queue:${queueId}`,
            `📋 后台任务 (${completed}/${total})`,
            {
              progress: total > 0 ? completed / total : undefined,
            },
          ),
        }));
        // 全部完成则 5 秒后移除
        if (completed >= total) {
          setTimeout(() => {
            set((s) => ({
              operations: s.operations.filter((o) =>
                o.id === `queue:${queueId}` ? false : true,
              ),
            }));
          }, 5000);
        }
      });
    },
  }),
);

/** 更新或插入操作 */
function upsertOp(
  ops: ActiveOperation[],
  id: string,
  label: string,
  opts: { progress?: number },
): ActiveOperation[] {
  const now = Date.now();
  const existing = ops.find((o) => o.id === id);
  if (existing) {
    return ops.map((o) =>
      o.id === id
        ? { ...o, label, progress: opts.progress, updatedAt: now }
        : o,
    );
  }
  return [
    ...ops.filter((o) => now - o.updatedAt < STALE_TIMEOUT_MS),
    { id, label, progress: opts.progress, updatedAt: now },
  ];
}
