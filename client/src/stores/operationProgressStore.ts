/**
 * operationProgressStore — 全局操作进度存储
 *
 * 监听 SSE 事件（dream:phase:changed / knowledge:compile:* / task:queue:progress），
 * 汇总展示所有正在进行的后台操作。
 */
import { create } from "zustand";
import { sseService } from "../services/sseService";

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
  /** 注册事件监听 */
  _init: () => void;
}

/** 自动清理 30 秒无更新的操作 */
const STALE_TIMEOUT_MS = 30000;

export const useOperationProgressStore = create<OperationProgressState>(
  (set) => ({
    operations: [],

    _init: () => {
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
          operations: upsertOp(s.operations, "dream", `🌙 梦境: ${label}`, {
            progress: (data.progress as number) ?? undefined,
          }),
        }));
      });

      sseService.on("dream:cycle:completed", (data) => {
        const status = data.status as string;
        set((s) => ({
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
