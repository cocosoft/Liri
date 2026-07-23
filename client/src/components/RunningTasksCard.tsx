/**
 * RunningTasksCard — 运行中任务状态卡片
 *
 * 从 ToolPanel 抽取，供 CronPage 和 TaskCenterPage 页面内使用。
 * 展示运行中任务列表 + 任务统计网格。
 */

import { useEffect, useState } from "react";
import type { CronTask } from "../types";
import { cronService } from "../services/cronService";

// ─── 子组件 ───────────────────────────────────────

/** 任务统计网格 */
function TaskStatsGrid({ tasks }: { tasks: CronTask[] }) {
  const running = tasks.filter((t) => t.enabled && t.status === "running");
  const idle = tasks.filter((t) => t.enabled && t.status !== "running");
  const errorCount = tasks.filter((t) => t.status === "error").length;

  return (
    <div className="grid grid-cols-4 gap-2 text-center text-xs">
      <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
        <span className="block text-lg font-bold text-gray-900 dark:text-white">
          {tasks.length}
        </span>
        <span className="text-gray-500 dark:text-gray-400">总数</span>
      </div>
      <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
        <span className="block text-lg font-bold text-green-600">
          {running.length}
        </span>
        <span className="text-gray-500 dark:text-gray-400">运行中</span>
      </div>
      <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
        <span className="block text-lg font-bold text-yellow-600">
          {idle.length}
        </span>
        <span className="text-gray-500 dark:text-gray-400">待命中</span>
      </div>
      <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
        <span className="block text-lg font-bold text-red-600">
          {errorCount}
        </span>
        <span className="text-gray-500 dark:text-gray-400">异常</span>
      </div>
    </div>
  );
}

/** 运行中任务列表 */
function RunningTasksList({ tasks }: { tasks: CronTask[] }) {
  const running = tasks.filter((t) => t.enabled && t.status === "running");

  if (tasks.length === 0) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
        暂无运行中的定时任务
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {running.length > 0 ? (
        running.map((task) => (
          <div
            key={task.id}
            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-sm transition-colors"
          >
            <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
            <span className="text-gray-600 dark:text-gray-400 truncate">
              {task.name}
            </span>
            <span className="ml-auto text-xs text-gray-400">
              运行中
            </span>
          </div>
        ))
      ) : (
        <div className="flex flex-col gap-1">
          {tasks.filter((t) => t.enabled).slice(0, 5).map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded text-sm"
            >
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  task.status === "error" ? "bg-red-500" : "bg-yellow-400"
                }`}
              />
              <span className="text-gray-600 dark:text-gray-400 truncate">
                {task.name}
              </span>
              <span className="ml-auto text-xs text-gray-400">
                {task.status === "error" ? "错误" : "待命"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 主组件 ───────────────────────────────────────

export default function RunningTasksCard() {
  const [tasks, setTasks] = useState<CronTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    cronService
      .list()
      .then((data) => {
        if (mounted) {
          setTasks(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-24 mb-2" />
        <div className="h-8 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg">
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
          运行中的任务
          {tasks.filter((t) => t.enabled && t.status === "running").length > 0 && (
            <span className="ml-2 text-xs text-blue-500">
              ({tasks.filter((t) => t.enabled && t.status === "running").length})
            </span>
          )}
        </h3>
      </div>
      <div className="p-4 space-y-4">
        <RunningTasksList tasks={tasks} />
        <TaskStatsGrid tasks={tasks} />
      </div>
    </div>
  );
}
