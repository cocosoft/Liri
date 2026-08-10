import { useEffect, useState } from "react";
import { sseService } from "../../services/sseService";
import {
  stateMachineService,
  type StateMachineInfo,
} from "../../services/backgroundTaskService";

/**
 * StateMachinePanel — 状态机监控面板（§十 阶段 D）
 *
 * 展示 StateMachineRegistry 中所有已注册状态机的当前状态与最近转移历史，
 * 并订阅 `background:state` SSE 事件实时刷新（无需手动点刷新）。
 * 供仪表盘（DashboardPage）监控区与运行状况页（BackgroundStatusPage）复用。
 */
function StateMachinePanel() {
  const [stateMachines, setStateMachines] = useState<StateMachineInfo[]>([]);

  const load = async () => {
    const states = await stateMachineService.getStateAll().catch(() => null);
    setStateMachines(states?.machines ?? []);
  };

  useEffect(() => {
    void load();

    // 订阅状态机转移事件，实时刷新对应卡片（background:* / task:*）
    const applyTransition = (
      machineId: string,
      payload: {
        state?: string;
        from?: string;
        to?: string;
        reason?: string;
        timestamp?: number;
      },
    ) => {
      const record = {
        from: payload.from ?? "-",
        to: payload.to ?? payload.state ?? "-",
        reason: payload.reason,
        timestamp: payload.timestamp ?? Date.now(),
      };
      setStateMachines((prev) => {
        const existing = prev.find((m) => m.id === machineId);
        if (!existing) return prev; // 未加载过聚合列表，等待下次全量刷新
        return prev.map((m) =>
          m.id === machineId
            ? {
                ...m,
                state: record.to,
                history: [...m.history, record].slice(-10),
              }
            : m,
        );
      });
    };
    const bgHandler = (payload: {
      taskId?: string;
      state?: string;
      from?: string;
      to?: string;
      reason?: string;
      timestamp?: number;
    }) => {
      if (!payload?.taskId) return;
      applyTransition(`background:${payload.taskId}`, payload);
    };
    const taskHandler = (payload: {
      taskId?: string;
      state?: string;
      from?: string;
      to?: string;
      reason?: string;
      timestamp?: number;
    }) => {
      if (!payload?.taskId) return;
      applyTransition(`task:${payload.taskId}`, payload);
    };
    sseService.on("background:state", bgHandler);
    sseService.on("task:state", taskHandler);
    return () => {
      sseService.off("background:state", bgHandler);
      sseService.off("task:state", taskHandler);
    };
  }, []);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
          <span>⚙️</span> 应用状态（状态机）
        </h3>
        <button
          onClick={() => void load()}
          className="px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300"
        >
          刷新
        </button>
      </div>

      {stateMachines.length === 0 ? (
        <div className="text-sm text-gray-400 dark:text-gray-500 py-3 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
          暂无已注册状态机（/v1/state/all 返回空）
        </div>
      ) : (
        <div className="space-y-2">
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
                      : m.state === "failed"
                        ? "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
                        : m.state === "busy"
                          ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300"
                          : m.state === "running"
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
                <div className="mt-1.5 space-y-0.5">
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
    </div>
  );
}

export default StateMachinePanel;
