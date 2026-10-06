/**
 * GenerationTaskCard + GenerationTaskList
 * 生成任务（图片 / 视频）进度卡片
 *
 * MD-10（2026-10-06，`.pyapp/output/媒体页排查报告.md`）：原 `TaskCard` / `TaskList`
 * （`VideoTaskItem` 版）**零调用方** —— 媒体页已统一渲染 `GenerationTaskList`
 * （`MediaPage.tsx:1474-1496`，消除"同一任务两张卡"）⇒ 按 `project_rules §1.3`
 * 「无兼容包袱」删除死代码（重试能力另有 `activeTasks` 轮询链路，未随删）。
 */

import React from "react";
import { useTranslation } from "react-i18next";
import type { GenerationTask } from "../../../stores/mediaStore";

// ============================================================
// GenerationTaskCard（统一图片/视频任务卡片）
// ============================================================

const GEN_STATUS_CONFIG: Record<
  GenerationTask["status"],
  { labelKey: string; color: string; icon: string }
> = {
  running: {
    labelKey: "media.taskRunning",
    color: "text-blue-500",
    icon: "🔄",
  },
  completed: {
    labelKey: "media.taskCompleted",
    color: "text-green-500",
    icon: "✅",
  },
  failed: { labelKey: "media.taskFailed", color: "text-red-500", icon: "❌" },
};

interface GenTaskCardProps {
  task: GenerationTask;
  onDelete?: (id: string) => void;
  /**
   * MD-10（2026-10-06）：失败任务「重试」—— **仅视频任务**提供。
   * 图片任务缺 model/size 等原始参数 ⇒ 无法忠实重放（宁可不给按钮，也不用不同参数静默重跑）。
   */
  onRetry?: (id: string) => void;
}

const GenTaskCard: React.FC<GenTaskCardProps> = ({
  task,
  onDelete,
  onRetry,
}) => {
  const { t } = useTranslation();
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
            {t(cfg.labelKey)}
          </span>
        </div>
        <p
          className="truncate text-[10px] text-gray-500 dark:text-gray-400"
          title={task.prompt}
        >
          {task.prompt || t("media.noPrompt")}
        </p>
        {isRunning && (
          <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600">
            <div
              className="h-full rounded-full bg-blue-500 transition-all duration-300"
              style={{ width: `${task.progress || 10}%` }}
            />
          </div>
        )}
        {/* BUG-8（2026-08-26）：多图生成全量展示，可点击查看/保存 */}
        {isDone && task.images && task.images.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {task.images.map((url, i) => (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noreferrer"
                title={t("media.viewImage")}
              >
                <img
                  src={url}
                  alt=""
                  className="h-10 w-10 rounded object-cover"
                  loading="lazy"
                />
              </a>
            ))}
          </div>
        )}
        {/* BUG-B（2026-08-26）：视频完成卡片展示结果（resultUrl 缩略图可点击） */}
        {isDone && task.type === "video" && task.resultUrl && (
          <div className="mt-1">
            <a
              href={task.resultUrl}
              target="_blank"
              rel="noreferrer"
              title={t("media.viewVideo")}
            >
              <video
                src={task.resultUrl}
                muted
                preload="metadata"
                className="h-10 w-10 rounded object-cover"
              />
            </a>
          </div>
        )}
        {task.error && (
          <p className="truncate text-[10px] text-red-400" title={task.error}>
            {task.error.slice(0, 60)}
          </p>
        )}
      </div>
      {/* MD-10：失败视频任务可**重试**（用原 `prompt` + `videoParams` 忠实重放） */}
      {onRetry && task.status === "failed" && task.type === "video" && (
        <button
          onClick={() => onRetry(task.id)}
          className="text-xs text-gray-400 hover:text-blue-500"
          title={t("common.retry")}
        >
          ↻
        </button>
      )}
      {/* P0-2（2026-08-26）：running 任务也可删除（取消/清理语义），不再仅完成/失败可删 */}
      {onDelete && (
        <button
          onClick={() => onDelete(task.id)}
          className="text-xs text-gray-400 hover:text-red-500"
          title={
            isDone || task.status === "failed"
              ? t("common.delete")
              : t("common.cancel")
          }
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
  /** MD-10（2026-10-06）：失败任务重试（仅视频） */
  onRetry?: (id: string) => void;
}

export const GenerationTaskList: React.FC<GenTaskListProps> = ({
  tasks,
  onDelete,
  onRetry,
}) => {
  const { t } = useTranslation();
  if (tasks.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400">
        {t("media.currentTasksTitle")}
      </h4>
      {tasks.map((task) => (
        <GenTaskCard
          key={task.id}
          task={task}
          onDelete={onDelete}
          onRetry={onRetry}
        />
      ))}
    </div>
  );
};
