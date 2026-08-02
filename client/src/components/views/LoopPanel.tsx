import { useState, useEffect } from "react";

interface LoopTask {
  id: string;
  description: string;
  interval: string;
  status: "running" | "paused";
  lastRun?: string;
}

/** 统一的 Loop 管理中心：/goal 和 /loop 任务状态面板 */
export default function LoopPanel() {
  const [tasks, setTasks] = useState<LoopTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 从后端加载活跃的 loop/goal 任务
    fetch("/v1/cron")
      .then((r) => r.json())
      .then((data) => {
        const mapped: LoopTask[] = (Array.isArray(data) ? data : []).map(
          (j: Record<string, unknown>) => ({
            id: (j.id as string) || "",
            description: (j.prompt || j.description || "") as string,
            interval: (j.expression || j.schedule || "") as string,
            status: j.enabled ? "running" : "paused",
            lastRun: j.lastRun as string | undefined,
          }),
        );
        setTasks(mapped);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
        Loop 管理中心
      </h2>

      {/* /goal 快速入口 */}
      <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50">
        <p className="text-sm text-blue-700 dark:text-blue-300 font-medium">
          /goal 命令
        </p>
        <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
          设置目标让 Liri 自动迭代直到达标。在对话中输入 /goal 描述。
        </p>
      </div>

      {/* /loop 快速入口 */}
      <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800/50">
        <p className="text-sm text-green-700 dark:text-green-300 font-medium">
          /loop 命令
        </p>
        <p className="text-xs text-green-600 dark:text-green-400 mt-1">
          创建定时循环任务。在对话中输入 /loop 5m 描述。
        </p>
      </div>

      {/* 活跃任务列表 */}
      <div>
        <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">
          活跃任务
        </h3>
        {loading ? (
          <p className="text-xs text-gray-400">加载中...</p>
        ) : tasks.length === 0 ? (
          <p className="text-xs text-gray-400">暂无活跃任务</p>
        ) : (
          <ul className="space-y-2">
            {tasks.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between p-2 rounded bg-gray-50 dark:bg-gray-800/50"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                    {t.description}
                  </p>
                  <p className="text-xs text-gray-400">{t.interval}</p>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    t.status === "running"
                      ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {t.status === "running" ? "运行中" : "已暂停"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
