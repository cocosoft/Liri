/**
 * 编排可视化组件
 *
 * 实时展示 DAG 编排执行过程：
 * - 任务依赖图（DAG 拓扑）
 * - 执行进度（分层并行）
 * - Rule Check Gate 状态
 * - 时间线视图
 */

import { useState, useEffect, useCallback } from "react";

// ========== 类型定义 ==========

/** 编排任务状态 */
interface OrchTask {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  dependsOn: string[];
  progress: number;
  result?: string;
  error?: string;
  durationMs?: number;
}

/** 规则检查结果 */
interface RuleCheck {
  ruleId: string;
  ruleName: string;
  passed: boolean;
  needsReview: boolean;
  message?: string;
}

/** 编排快照 */
interface OrchestrationSnapshot {
  workItemId: string;
  status:
    "idle" | "planning" | "executing" | "checking" | "completed" | "failed";
  tasks: OrchTask[];
  ruleChecks: RuleCheck[];
  layers: string[][];
  currentLayer: number;
  startTime: string;
  updatedAt: string;
}

/** 编排事件 */
interface OrchEvent {
  type: string;
  data: Record<string, unknown>;
}

// ========== 组件 Props ==========

interface OrchestrationViewProps {
  workspaceId: string;
  workItemId: string;
  isDark: boolean;
}

// ========== 状态配色 ==========

const STATUS_COLORS: Record<
  string,
  { bg: string; border: string; text: string }
> = {
  pending: {
    bg: "bg-gray-100 dark:bg-gray-800",
    border: "border-gray-300 dark:border-gray-600",
    text: "text-gray-500",
  },
  running: {
    bg: "bg-blue-50 dark:bg-blue-900/20",
    border: "border-blue-400",
    text: "text-blue-600",
  },
  completed: {
    bg: "bg-green-50 dark:bg-green-900/20",
    border: "border-green-400",
    text: "text-green-600",
  },
  failed: {
    bg: "bg-red-50 dark:bg-red-900/20",
    border: "border-red-400",
    text: "text-red-600",
  },
};

const STATUS_LABELS: Record<string, string> = {
  pending: "待执行",
  running: "执行中",
  completed: "已完成",
  failed: "已失败",
};

/**
 * 编排可视化组件
 */
function OrchestrationView({
  workspaceId,
  workItemId,
  isDark,
}: OrchestrationViewProps) {
  const [snapshot, setSnapshot] = useState<OrchestrationSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [viewMode, setViewMode] = useState<"dag" | "timeline">("dag");
  const [error, setError] = useState<string | null>(null);

  // 连接 SSE 流
  useEffect(() => {
    const url = `/v1/workspaces/${workspaceId}/items/${workItemId}/orchestration/stream`;
    const eventSource = new EventSource(url);

    eventSource.addEventListener("connected", () => {
      setConnected(true);
      setError(null);
    });

    eventSource.addEventListener("snapshot", (e) => {
      const data = JSON.parse(e.data) as OrchestrationSnapshot;
      setSnapshot(data);
    });

    eventSource.addEventListener("orch:dag:task:start", (e) => {
      const data = JSON.parse(e.data) as OrchEvent;
      setSnapshot((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          status: "executing",
          tasks: prev.tasks.map((t) =>
            t.id === data.data.taskId
              ? { ...t, status: "running", progress: 0 }
              : t,
          ),
        };
      });
    });

    eventSource.addEventListener("orch:dag:task:progress", (e) => {
      const data = JSON.parse(e.data) as OrchEvent;
      setSnapshot((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tasks: prev.tasks.map((t) =>
            t.id === data.data.taskId
              ? { ...t, progress: (data.data.progress as number) || 0 }
              : t,
          ),
        };
      });
    });

    eventSource.addEventListener("orch:dag:task:end", (e) => {
      const data = JSON.parse(e.data) as OrchEvent;
      setSnapshot((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tasks: prev.tasks.map((t) =>
            t.id === data.data.taskId
              ? {
                  ...t,
                  status: data.data.success ? "completed" : "failed",
                  progress: 100,
                  result: data.data.content as string,
                  error: data.data.error as string,
                  durationMs: data.data.durationMs as number,
                }
              : t,
          ),
        };
      });
    });

    eventSource.addEventListener("orch:dag:end", () => {
      setSnapshot((prev) => {
        if (!prev) return prev;
        return { ...prev, status: "completed" };
      });
    });

    eventSource.addEventListener("orch:rule:check:start", (e) => {
      const data = JSON.parse(e.data) as OrchEvent;
      setSnapshot((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          status: "checking",
          ruleChecks: [
            ...prev.ruleChecks,
            {
              ruleId: data.data.ruleId as string,
              ruleName: data.data.ruleName as string,
              passed: false,
              needsReview: false,
            },
          ],
        };
      });
    });

    eventSource.addEventListener("orch:rule:check:pass", (e) => {
      const data = JSON.parse(e.data) as OrchEvent;
      setSnapshot((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          ruleChecks: prev.ruleChecks.map((rc) =>
            rc.ruleId === data.data.ruleId
              ? { ...rc, passed: true, message: data.data.message as string }
              : rc,
          ),
        };
      });
    });

    eventSource.addEventListener("orch:rule:check:fail", (e) => {
      const data = JSON.parse(e.data) as OrchEvent;
      setSnapshot((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          ruleChecks: prev.ruleChecks.map((rc) =>
            rc.ruleId === data.data.ruleId
              ? {
                  ...rc,
                  passed: false,
                  needsReview: data.data.needsReview as boolean,
                  message: data.data.message as string,
                }
              : rc,
          ),
        };
      });
    });

    eventSource.addEventListener("heartbeat", () => {
      // 心跳，保持连接
    });

    eventSource.onerror = () => {
      setConnected(false);
      setError("连接中断，正在重连...");
    };

    return () => {
      eventSource.close();
    };
  }, [workspaceId, workItemId]);

  // 获取总体进度
  const getOverallProgress = useCallback(() => {
    if (!snapshot || snapshot.tasks.length === 0) return 0;
    const completed = snapshot.tasks.filter(
      (t) => t.status === "completed" || t.status === "failed",
    ).length;
    return Math.round((completed / snapshot.tasks.length) * 100);
  }, [snapshot]);

  if (!snapshot) {
    return (
      <div
        className={`p-6 text-center ${isDark ? "text-gray-400" : "text-gray-500"}`}
      >
        {connected ? "等待编排数据..." : "正在连接..."}
      </div>
    );
  }

  return (
    <div className={`p-4 ${isDark ? "text-gray-200" : "text-gray-800"}`}>
      {/* 头部状态 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold">编排执行</h3>
          <span
            className={`px-2 py-0.5 rounded text-xs font-medium ${
              snapshot.status === "executing"
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                : snapshot.status === "completed"
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : snapshot.status === "failed"
                    ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                    : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
            }`}
          >
            {snapshot.status === "executing"
              ? "执行中"
              : snapshot.status === "completed"
                ? "已完成"
                : snapshot.status === "failed"
                  ? "失败"
                  : "空闲"}
          </span>
          <span
            className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`}
            title={connected ? "已连接" : "已断开"}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode("dag")}
            className={`px-3 py-1 text-xs rounded ${
              viewMode === "dag"
                ? "bg-blue-500 text-white"
                : isDark
                  ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
            }`}
          >
            DAG 图
          </button>
          <button
            onClick={() => setViewMode("timeline")}
            className={`px-3 py-1 text-xs rounded ${
              viewMode === "timeline"
                ? "bg-blue-500 text-white"
                : isDark
                  ? "bg-gray-700 text-gray-300 hover:bg-gray-600"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
            }`}
          >
            时间线
          </button>
        </div>
      </div>

      {/* 总体进度条 */}
      {snapshot.tasks.length > 0 && (
        <div className="mb-4">
          <div className="flex justify-between text-xs mb-1">
            <span>总体进度</span>
            <span>{getOverallProgress()}%</span>
          </div>
          <div
            className={`w-full h-2 rounded-full ${isDark ? "bg-gray-700" : "bg-gray-200"}`}
          >
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${getOverallProgress()}%` }}
            />
          </div>
        </div>
      )}

      {/* DAG 视图 */}
      {viewMode === "dag" && (
        <div className="space-y-3">
          {snapshot.layers.map((layer, layerIndex) => (
            <div key={layerIndex}>
              <div className="text-xs text-gray-500 mb-1">
                第 {layerIndex + 1} 层（并行执行）
              </div>
              <div className="flex flex-wrap gap-2">
                {layer.map((taskId) => {
                  const task = snapshot.tasks.find((t) => t.id === taskId);
                  if (!task) return null;
                  const colors = STATUS_COLORS[task.status];
                  return (
                    <div
                      key={taskId}
                      className={`flex-1 min-w-[150px] p-3 rounded-lg border ${colors.bg} ${colors.border}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">{task.name}</span>
                        <span className={`text-xs ${colors.text}`}>
                          {STATUS_LABELS[task.status]}
                        </span>
                      </div>
                      {task.status === "running" && (
                        <div
                          className={`w-full h-1.5 rounded-full ${isDark ? "bg-gray-600" : "bg-gray-200"}`}
                        >
                          <div
                            className="h-full rounded-full bg-blue-500 transition-all duration-300"
                            style={{ width: `${task.progress}%` }}
                          />
                        </div>
                      )}
                      {task.durationMs !== undefined && (
                        <div className="text-xs text-gray-500 mt-1">
                          {(task.durationMs / 1000).toFixed(1)}s
                        </div>
                      )}
                      {task.error && (
                        <div className="text-xs text-red-500 mt-1">
                          {task.error}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 时间线视图 */}
      {viewMode === "timeline" && (
        <div className="space-y-2">
          {snapshot.tasks.map((task, i) => {
            const colors = STATUS_COLORS[task.status];
            return (
              <div key={task.id} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-3 h-3 rounded-full ${colors.border.replace("border", "bg")}`}
                  />
                  {i < snapshot.tasks.length - 1 && (
                    <div
                      className={`w-0.5 h-8 ${isDark ? "bg-gray-600" : "bg-gray-300"}`}
                    />
                  )}
                </div>
                <div className="flex-1 pb-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{task.name}</span>
                    <span className={`text-xs ${colors.text}`}>
                      {STATUS_LABELS[task.status]}
                    </span>
                  </div>
                  {task.dependsOn.length > 0 && (
                    <div className="text-xs text-gray-500">
                      依赖:{" "}
                      {task.dependsOn
                        .map(
                          (d) =>
                            snapshot.tasks.find((t) => t.id === d)?.name || d,
                        )
                        .join(", ")}
                    </div>
                  )}
                  {task.status === "running" && (
                    <div
                      className={`w-full h-1.5 rounded-full mt-1 ${isDark ? "bg-gray-600" : "bg-gray-200"}`}
                    >
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all"
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                  )}
                  {task.error && (
                    <div className="text-xs text-red-500 mt-1">
                      {task.error}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Rule Check Gate */}
      {snapshot.ruleChecks.length > 0 && (
        <div className="mt-6">
          <h4 className="text-sm font-semibold mb-2">Rule Check Gate</h4>
          <div className="space-y-2">
            {snapshot.ruleChecks.map((rc) => (
              <div
                key={rc.ruleId}
                className={`p-2 rounded border text-sm ${
                  rc.passed
                    ? "bg-green-50 border-green-300 dark:bg-green-900/20 dark:border-green-700"
                    : rc.needsReview
                      ? "bg-yellow-50 border-yellow-300 dark:bg-yellow-900/20 dark:border-yellow-700"
                      : "bg-red-50 border-red-300 dark:bg-red-900/20 dark:border-red-700"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{rc.passed ? "✓" : rc.needsReview ? "⚠" : "✗"}</span>
                  <span className="font-medium">{rc.ruleName}</span>
                  <span
                    className={`text-xs ${rc.passed ? "text-green-600" : rc.needsReview ? "text-yellow-600" : "text-red-600"}`}
                  >
                    {rc.passed ? "通过" : rc.needsReview ? "需审核" : "未通过"}
                  </span>
                </div>
                {rc.message && (
                  <div className="text-xs mt-1 text-gray-500">{rc.message}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 p-2 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded text-sm text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}

export default OrchestrationView;
export type { OrchestrationSnapshot, OrchTask, RuleCheck };
