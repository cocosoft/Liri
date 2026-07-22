/**
 * TaskCard + TaskList
 * 异步视频任务进度卡片（Phase 1）
 *
 * 展示 pending/queued/running/completed/failed 五种状态
 */

import React from "react";
import type { VideoTaskItem, GenerationTask } from "../../../stores/mediaStore";

// ============================================================
// TaskCard
// ============================================================

interface TaskCardProps {
  task: VideoTaskItem;
  onCancel?: (taskId: string) => void;
  onRetry?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
}

const STATUS_CONFIG: Record<
  VideoTaskItem["status"],
  { label: string; color: string; icon: string }
> = {
  pending: { label: "准备中…", color: "text-gray-400", icon: "⏳" },
  queued: { label: "排队中", color: "text-yellow-500", icon: "🕐" },
  running: { label: "生成中", color: "text-blue-500", icon: "🔄" },
  completed: { label: "已完成", color: "text-green-500", icon: "✅" },
  failed: { label: "失败", color: "text-red-500", icon: "❌" },
};

/** 格式化排队位置（简化为显示状态） */
function queueLabel(task: VideoTaskItem): string {
  if (task.status === "queued") return "排队中";
  return STATUS_CONFIG[task.status].label;
}

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  onCancel,
  onRetry,
  onDelete,
}) => {
  const cfg = STATUS_CONFIG[task.status];
  const isActive = ["pending", "queued", "running"].includes(task.status);
  const isDone = task.status === "completed";
  const isFailed = task.status === "failed";

  return (
    <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      {/* 缩略图 / 状态图标 */}
      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md bg-gray-100 dark:bg-gray-700">
        {isActive && <span className="animate-pulse text-xl">{cfg.icon}</span>}
        {isDone && task.resultVideoUrl && <span className="text-xl">▶️</span>}
        {isDone && !task.resultVideoUrl && (
          <span className="text-xl">{cfg.icon}</span>
        )}
        {isFailed && <span className="text-xl">{cfg.icon}</span>}
      </div>

      {/* 信息 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-medium ${cfg.color}`}>
            {queueLabel(task)}
          </span>
          {isActive && (
            <span className="text-xs text-gray-400">{task.progress}%</span>
          )}
        </div>

        {/* 进度条 */}
        {isActive && (
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-500"
              style={{ width: `${Math.max(task.progress || 0, 2)}%` }}
            />
          </div>
        )}

        {isFailed && task.error && (
          <details className="mt-0.5">
            <summary className="cursor-pointer text-xs text-red-400 hover:text-red-500">
              {task.error.slice(0, 80)}
              {task.error.length > 80 ? "…" : ""}
            </summary>
            <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-300">
              {task.error}
            </pre>
          </details>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex flex-shrink-0 gap-1">
        {isActive && onCancel && (
          <button
            onClick={() => onCancel(task.taskId)}
            className="rounded px-2 py-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            title="取消"
          >
            取消
          </button>
        )}
        {isFailed && onRetry && (
          <button
            onClick={() => onRetry(task.taskId)}
            className="rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600"
          >
            重试
          </button>
        )}
        {(isDone || isFailed) && onDelete && (
          <button
            onClick={() => onDelete(task.taskId)}
            className="rounded px-2 py-1 text-xs text-gray-400 hover:text-red-500"
            title="删除"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
};

// ============================================================
// TaskList
// ============================================================

interface TaskListProps {
  tasks: VideoTaskItem[];
  onCancel?: (taskId: string) => void;
  onRetry?: (taskId: string) => void;
  onDelete?: (taskId: string) => void;
}

export const TaskList: React.FC<TaskListProps> = ({
  tasks,
  onCancel,
  onRetry,
  onDelete,
}) => {
  if (tasks.length === 0) return null;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">
        生成任务
      </h4>
      {tasks.map((task) => (
        <TaskCard
          key={task.taskId}
          task={task}
          onCancel={onCancel}
          onRetry={onRetry}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
};

// ============================================================
// GenerationTaskCard（统一图片/视频任务卡片）
// ============================================================

const GEN_STATUS_CONFIG = {
  running: { label: "生成中", color: "text-blue-500", icon: "🔄" },
  completed: { label: "已完成", color: "text-green-500", icon: "✅" },
  failed: { label: "失败", color: "text-red-500", icon: "❌" },
};

interface GenTaskCardProps {
  task: GenerationTask;
  onDelete?: (id: string) => void;
}

const GenTaskCard: React.FC<GenTaskCardProps> = ({ task, onDelete }) => {
  const cfg = GEN_STATUS_CONFIG[task.status];
  const isRunning = task.status === "running";
  const isDone = task.status === "completed";

  return (
    <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white p-2 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <span className={`text-lg ${isRunning ? "animate-pulse" : ""}`}>
        {cfg.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-400">
            {task.type === "image" ? "🖼️" : "🎬"}
          </span>
          <span className={`text-xs font-medium ${cfg.color}`}>
            {cfg.label}
          </span>
        </div>
        <p
          className="truncate text-[10px] text-gray-500 dark:text-gray-400"
          title={task.prompt}
        >
          {task.prompt || "(无提示词)"}
        </p>
        {isRunning && (
          <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${task.progress || 10}%` }}
            />
          </div>
        )}
        {task.error && (
          <p className="truncate text-[10px] text-red-400" title={task.error}>
            {task.error.slice(0, 60)}
          </p>
        )}
      </div>
      {(isDone || task.status === "failed") && onDelete && (
        <button
          onClick={() => onDelete(task.id)}
          className="text-xs text-gray-400 hover:text-red-500"
        >
          ✕
        </button>
      )}
    </div>
  );
};

// ============================================================
// GenerationTaskList
// ============================================================

interface GenTaskListProps {
  tasks: GenerationTask[];
  onDelete?: (id: string) => void;
}

export const GenerationTaskList: React.FC<GenTaskListProps> = ({
  tasks,
  onDelete,
}) => {
  if (tasks.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">
        当前任务
      </h4>
      {tasks.map((task) => (
        <GenTaskCard key={task.id} task={task} onDelete={onDelete} />
      ))}
    </div>
  );
};
