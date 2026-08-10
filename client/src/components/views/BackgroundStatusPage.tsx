import { useEffect, useState } from "react";
import {
  backgroundStatusService,
  stateMachineService,
  type BackgroundStatus,
  type StateMachineInfo,
} from "../../services/backgroundTaskService";

/** 后台任务运行状况面板 — 展示"功能承诺 vs 实际执行" */
function BackgroundStatusPage() {
  const [data, setData] = useState<BackgroundStatus | null>(null);
  const [stateMachines, setStateMachines] = useState<StateMachineInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [status, states] = await Promise.all([
        backgroundStatusService.getStatus(),
        stateMachineService.getStateAll().catch(() => null),
      ]);
      setData(status);
      setStateMachines(states?.machines ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const formatTime = (ts: number | null) => {
    if (!ts) return "从未执行";
    return new Date(ts).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              运行状况
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              后台任务执行情况一览 —— 回答"这个功能到底跑没跑"
            </p>
          </div>
          <button
            onClick={() => void load()}
            className="px-3 py-1.5 text-xs rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
          >
            刷新
          </button>
        </div>

        {isLoading && (
          <div className="text-center py-12 text-gray-400 dark:text-gray-500">
            加载中...
          </div>
        )}

        {error && (
          <div className="p-4 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm mb-4">
            加载失败：{error}
            <button
              onClick={() => void load()}
              className="ml-2 underline hover:no-underline"
            >
              重试
            </button>
          </div>
        )}

        {data && (
          <div className="space-y-6">
            {/* Dream 记忆整理 */}
            <section className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                🌙 记忆整理（Dream）
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-center">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    完成次数
                  </div>
                  <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                    {data.dream.stats.totalCompleted}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-center">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    整理会话
                  </div>
                  <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                    {data.dream.stats.totalSessions}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-center">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    生成洞察
                  </div>
                  <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                    {data.dream.stats.totalInsights}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-center">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    最近执行
                  </div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 mt-1">
                    {formatTime(data.dream.stats.lastDreamAt)}
                  </div>
                </div>
              </div>

              <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                最近记录（{data.dream.recentLogs.length}）
              </div>
              {data.dream.recentLogs.length === 0 ? (
                <div className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
                  暂无记录 —— 若会话量/时间不足会被跳过（见后端日志）
                </div>
              ) : (
                <div className="space-y-1">
                  {data.dream.recentLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-xs"
                    >
                      <span className="truncate text-gray-700 dark:text-gray-300">
                        {log.summary}
                      </span>
                      <span className="flex-shrink-0 text-gray-400 dark:text-gray-500">
                        {formatTime(log.timestamp)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Buddy 成长 */}
            <section className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                🐣 伙伴成长（Buddy）
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-center">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    梦境完成
                  </div>
                  <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                    {data.buddyGrowth.totalCompleted}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-center">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    累计会话
                  </div>
                  <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                    {data.buddyGrowth.totalSessions}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-center">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    任务完成
                  </div>
                  <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                    {data.buddyGrowth.taskCompletionCount}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 text-center">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    累计经验
                  </div>
                  <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1">
                    {data.buddyGrowth.totalTaskExp}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.buddyGrowth.unlockedAchievements.length === 0 ? (
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    暂无成就（达成里程碑后自动解锁）
                  </span>
                ) : (
                  data.buddyGrowth.unlockedAchievements.map((a) => (
                    <span
                      key={a}
                      className="px-2 py-1 text-xs rounded-full bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-300 border border-purple-200 dark:border-purple-800"
                    >
                      🏆 {a}
                    </span>
                  ))
                )}
              </div>
            </section>

            {/* 应用状态（§十 阶段 D） */}
            <section className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                ⚙️ 应用状态（状态机）
              </h3>
              {stateMachines.length === 0 ? (
                <div className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
                  暂无已注册状态机（/v1/state/all 返回空）
                </div>
              ) : (
                <div className="space-y-3">
                  {stateMachines.map((m) => (
                    <div
                      key={m.id}
                      className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                          {m.id}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                            m.state === "error"
                              ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
                              : m.state === "busy"
                                ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                                : m.state === "paused"
                                  ? "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300"
                                  : "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                          }`}
                        >
                          {m.state}
                        </span>
                      </div>
                      {m.history.length > 0 && (
                        <div className="mt-2 space-y-0.5">
                          {m.history.slice(-3).map((h, i) => (
                            <div
                              key={i}
                              className="text-xs text-gray-500 dark:text-gray-400"
                            >
                              {h.from} → {h.to}
                              {h.reason ? `（${h.reason}）` : ""}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

export default BackgroundStatusPage;
