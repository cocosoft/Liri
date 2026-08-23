import { useState } from "react";
import type { TaskCardData, TaskCardTask } from "../../types";
import { usePlanTaskStore } from "../../stores/planTaskStore";
import DAGMiniMap from "./DAGMiniMap";
import DAGFullScreen from "./DAGFullScreen";

interface TaskCardProps {
  data: TaskCardData;
}

const STATUS_CONFIG: Record<
  TaskCardTask["status"],
  { icon: string; color: string; label: string }
> = {
  pending: { icon: "○", color: "text-gray-400", label: "等待中" },
  in_progress: {
    icon: "⟳",
    color: "text-blue-500 animate-spin inline-block",
    label: "执行中",
  },
  completed: { icon: "✓", color: "text-green-500", label: "已完成" },
  failed: { icon: "✗", color: "text-red-500", label: "失败" },
  // S3 修复（2026-08-23）：cancelled 独立终态（用户中止），橙色区别于 failed
  cancelled: { icon: "⏹", color: "text-orange-500", label: "已取消" },
  blocked: { icon: "⏸", color: "text-orange-400", label: "等待依赖" },
  // T5 修复：后端 todo-types.ts 存在 skipped 状态，此前无映射时
  // cfg 回退到 pending，被跳过的任务错误显示"○ 等待中"
  skipped: { icon: "↷", color: "text-gray-400", label: "已跳过" },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** 从 dependsOn 构建 human-readable 的依赖标签 */
function renderDepends(
  dependsOn: string[],
  tasks: TaskCardTask[],
): string | null {
  if (dependsOn.length === 0) return null;
  const names = dependsOn
    .map((id) => tasks.find((t) => t.id === id)?.name || id)
    .join(", ");
  return `等待: ${names}`;
}

export default function TaskCard({ data }: TaskCardProps) {
  // P2（08-09）：当有 planId 时，从 planTaskStore 读取实时数据
  const liveData = usePlanTaskStore((s) =>
    data.planId ? s.tasks[data.planId] : null,
  );
  const merged = liveData ?? data;

  const { title, tasks, status } = merged;
  const isExecuting = status === "executing";
  // 修复："全部完成"徽章仅当任务级**全部** completed 时显示——
  // 原实现只看卡片级 status==="done"，与 freezeAll 一刀切 done 叠加后，
  // 中止/含 failed 的任务卡也亮"全部完成"徽章，与任务列表状态自相矛盾。
  const isAllCompleted =
    status === "done" &&
    tasks.length > 0 &&
    tasks.every((t) => t.status === "completed");
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  const hasDependencies = tasks.some((t) => t.dependsOn.length > 0);
  const [expanded, setExpanded] = useState(false);
  const [showDAG, setShowDAG] = useState(false);
  const [showFullDAG, setShowFullDAG] = useState(false);

  return (
    <div
      className={`my-2 rounded-xl bg-white dark:bg-gray-800 overflow-hidden border ${
        expanded
          ? "border-gray-200 dark:border-gray-700 shadow-sm"
          : "border-gray-200/70 dark:border-gray-700/70"
      }`}
    >
      {/* 卡片标题栏（兼作展开/收起开关，默认折叠为一行摘要） */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full px-3 flex items-center justify-between text-left cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${
          expanded
            ? "py-2 border-b border-gray-100 dark:border-gray-700"
            : "py-1.5"
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm flex-shrink-0">📋</span>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            任务分解：{title}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isAllCompleted && (
            <span className="text-xs px-2 py-0.5 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full">
              全部完成
            </span>
          )}
          {status === "done" && !isAllCompleted && (
            <span className="text-xs px-2 py-0.5 bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded-full">
              已结束{failed > 0 ? `（${failed} 失败）` : ""}
            </span>
          )}
          {isExecuting && (
            <span className="text-xs px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-full">
              {completed}/{total} 完成{failed > 0 ? `, ${failed} 失败` : ""}
            </span>
          )}
          <span
            className={`text-xs text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
              expanded ? "rotate-180" : ""
            }`}
          >
            ▼
          </span>
        </div>
      </button>

      {/* 展开后：任务列表 + DAG 依赖图 */}
      {expanded && (
        <>
          <div className="px-3 py-1.5 space-y-1">
            {tasks.map((task, index) => {
              const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.pending;
              const deps = renderDepends(task.dependsOn, tasks);

              return (
                <div
                  key={task.id}
                  className={`flex items-center gap-1.5 py-1 px-1.5 rounded-lg transition-colors ${
                    task.status === "in_progress"
                      ? "bg-blue-50 dark:bg-blue-900/20"
                      : task.status === "completed"
                        ? "bg-green-50/50 dark:bg-green-900/10"
                        : task.status === "failed"
                          ? "bg-red-50/50 dark:bg-red-900/10"
                          : ""
                  }`}
                >
                  {/* 序号 + 状态图标 */}
                  <span className="text-xs text-gray-400 dark:text-gray-500 w-3 flex-shrink-0 text-right">
                    {index + 1}.
                  </span>
                  <span className={`text-xs flex-shrink-0 ${cfg.color}`}>
                    {cfg.icon}
                  </span>

                  {/* 任务名称 */}
                  <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1 min-w-0">
                    {task.name}
                  </span>

                  {/* 状态标签或被阻塞的原因 */}
                  {task.status === "blocked" && deps ? (
                    <span className="text-xs text-orange-500 dark:text-orange-400 truncate flex-shrink-0 max-w-[160px]">
                      {deps}
                    </span>
                  ) : task.status === "in_progress" ? (
                    <span className="text-xs text-blue-500 dark:text-blue-400 flex-shrink-0">
                      {cfg.label}
                    </span>
                  ) : task.durationMs !== undefined ? (
                    <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                      {formatDuration(task.durationMs)}
                    </span>
                  ) : (
                    <span className={`text-xs ${cfg.color} flex-shrink-0`}>
                      {cfg.label}
                    </span>
                  )}

                  {/* 结果指示 */}
                  {task.status === "completed" && task.result && (
                    <span className="text-xs text-gray-400 dark:text-gray-500 truncate flex-shrink-0 max-w-[120px]">
                      {task.result}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* DAG 依赖图（有依赖关系时展示） */}
          {hasDependencies && (
            <div className="border-t border-gray-100 dark:border-gray-700">
              <button
                onClick={() => setShowDAG(!showDAG)}
                className="w-full px-3 py-1 text-xs text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors flex items-center gap-1 justify-center"
              >
                <span>{showDAG ? "▲" : "▼"}</span>
                <span>
                  查看依赖关系图 (
                  {tasks.filter((t) => t.dependsOn.length > 0).length} 个节点,{" "}
                  {tasks.reduce((sum, t) => sum + t.dependsOn.length, 0)} 条边)
                </span>
              </button>
              {showDAG && (
                <div className="px-2 pb-2">
                  <DAGMiniMap
                    tasks={tasks}
                    height={200}
                    onExpand={() => setShowFullDAG(true)}
                  />
                </div>
              )}
            </div>
          )}

          {/* 全屏 DAG 弹窗 */}
          {showFullDAG && (
            <DAGFullScreen
              tasks={tasks}
              title={title}
              onClose={() => setShowFullDAG(false)}
            />
          )}
        </>
      )}
    </div>
  );
}
