import { useState } from "react";
import type { TaskCardData, TaskCardTask } from "../../types";
import DAGMiniMap from "./DAGMiniMap";
import DAGFullScreen from "./DAGFullScreen";

interface TaskCardProps {
  data: TaskCardData;
  sessionId?: string;
  /** 注入消息到对话流 */
  onSendMessage?: (content: string) => void;
}

const STATUS_CONFIG: Record<TaskCardTask["status"], { icon: string; color: string; label: string }> = {
  pending: { icon: "○", color: "text-gray-400", label: "等待中" },
  in_progress: { icon: "⟳", color: "text-blue-500 animate-spin inline-block", label: "执行中" },
  completed: { icon: "✓", color: "text-green-500", label: "已完成" },
  failed: { icon: "✗", color: "text-red-500", label: "失败" },
  blocked: { icon: "⏸", color: "text-orange-400", label: "等待依赖" },
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** 从 dependsOn 构建 human-readable 的依赖标签 */
function renderDepends(dependsOn: string[], tasks: TaskCardTask[]): string | null {
  if (dependsOn.length === 0) return null;
  const names = dependsOn
    .map((id) => tasks.find((t) => t.id === id)?.name || id)
    .join(", ");
  return `等待: ${names}`;
}

export default function TaskCard({ data, onSendMessage }: TaskCardProps) {
  const { title, tasks, status } = data;
  const isExecuting = status === "executing";
  const isDone = status === "done";
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "completed").length;
  const failed = tasks.filter((t) => t.status === "failed").length;
  const hasDependencies = tasks.some((t) => t.dependsOn.length > 0);
  const [showDAG, setShowDAG] = useState(false);
  const [showFullDAG, setShowFullDAG] = useState(false);

  /** 开始执行 */
  const handleStart = () => {
    onSendMessage?.(`▶ 开始执行计划：${title}`);
  };

  /** 用户调整 */
  const handleAdjust = () => {
    onSendMessage?.(`✏ 调整方案：${title}`);
  };

  /** 中止执行 */
  const handleAbort = () => {
    onSendMessage?.(`🛑 中止执行：${title}`);
  };

  /** 重试失败任务 */
  const handleRetry = () => {
    const failedTask = tasks.find((t) => t.status === "failed");
    onSendMessage?.(`🔁 重试：${failedTask?.name || title}`);
  };

  return (
    <div className="my-2 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 overflow-hidden shadow-sm">
      {/* 卡片标题栏 */}
      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm flex-shrink-0">📋</span>
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
            任务分解：{title}
          </span>
        </div>
        {isDone && (
          <span className="text-xs px-2 py-0.5 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full flex-shrink-0">
            全部完成
          </span>
        )}
        {isExecuting && (
          <span className="text-xs px-2 py-0.5 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded-full flex-shrink-0">
            {completed}/{total} 完成{failed > 0 ? `, ${failed} 失败` : ""}
          </span>
        )}
      </div>

      {/* 任务列表 */}
      <div className="px-3 py-1.5 space-y-1">
        {tasks.map((task) => {
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
                {task.id}.
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
            <span>查看依赖关系图 ({tasks.filter((t) => t.dependsOn.length > 0).length} 个节点, {tasks.reduce((sum, t) => sum + t.dependsOn.length, 0)} 条边)</span>
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

      {/* 底部操作栏 */}
      <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 flex items-center gap-2 flex-wrap">
        {status === "planning" && (
          <>
            <span className="text-xs text-gray-500 dark:text-gray-400 flex-1">
              AI 建议的方案，确认后开始执行
            </span>
            <button
              type="button"
              onClick={handleStart}
              className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              ▶ 开始执行
            </button>
            <button
              type="button"
              onClick={handleAdjust}
              className="text-xs px-3 py-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
            >
              ✏ 我想调整
            </button>
          </>
        )}
        {isExecuting && (
          <div className="flex items-center gap-2 w-full">
            <span className="text-xs text-blue-600 dark:text-blue-400 flex-1">
              执行中... 在输入框回复可随时干预
            </span>
            <button
              type="button"
              onClick={handleAbort}
              className="text-xs px-3 py-1 bg-red-100 dark:bg-red-900/30 hover:bg-red-200 dark:hover:bg-red-900/50 text-red-700 dark:text-red-400 rounded-lg transition-colors"
            >
              🛑 中止
            </button>
          </div>
        )}
        {isDone && (
          <div className="flex items-center gap-2 w-full">
            <span className="text-xs text-gray-500 dark:text-gray-400 flex-1">
              所有任务执行完毕{failed > 0 ? `（${failed} 个失败）` : ''}
            </span>
            {failed > 0 && (
              <button
                type="button"
                onClick={handleRetry}
                className="text-xs px-3 py-1 bg-orange-100 dark:bg-orange-900/30 hover:bg-orange-200 dark:hover:bg-orange-900/50 text-orange-700 dark:text-orange-400 rounded-lg transition-colors"
              >
                🔁 重试失败
              </button>
            )}
          </div>
        )}
      </div>

      {/* 全屏 DAG 弹窗 */}
      {showFullDAG && (
        <DAGFullScreen
          tasks={tasks}
          title={title}
          onClose={() => setShowFullDAG(false)}
        />
      )}
    </div>
  );
}
