import { useTranslation } from "react-i18next";

interface TrajectoryStep {
  id: string;
  timestamp: number;
  action: string;
  input: string;
  output: string;
  duration?: number;
}

interface Trajectory {
  id: string;
  name: string;
  startedAt: number;
  completedAt: number | null;
  status: "running" | "completed" | "failed";
  steps: TrajectoryStep[];
}

interface AgentTrajectoryViewProps {
  isDark: boolean;
  trajectories: Trajectory[];
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  analyze: { label: "agent.kanban", color: "text-purple-500" },
  plan: { label: "agent.plan", color: "text-blue-500" },
  execute: { label: "agent.execute", color: "text-green-500" },
  test: { label: "agent.test", color: "text-yellow-500" },
  review: { label: "agent.review", color: "text-red-500" },
};

function AgentTrajectoryView({
  isDark,
  trajectories,
}: AgentTrajectoryViewProps) {
  const { t } = useTranslation();
  const displayTrajectories = trajectories;

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return "-";
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2
          className={`text-lg font-medium ${isDark ? "text-gray-100" : "text-gray-900"}`}
        >
          执行轨迹 / 彩排
        </h2>
        <button
          className={`px-3 py-1.5 rounded-lg text-sm ${
            isDark
              ? "bg-blue-600 hover:bg-blue-700 text-white"
              : "bg-blue-500 hover:bg-blue-600 text-white"
          }`}
        >
          开始彩排
        </button>
      </div>

      <div className="space-y-4">
        {displayTrajectories.map((trajectory) => (
          <div
            key={trajectory.id}
            className={`rounded-lg border ${isDark ? "bg-gray-800 border-gray-700" : "bg-white border-gray-200"}`}
          >
            <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <h3
                  className={`font-medium ${isDark ? "text-gray-200" : "text-gray-800"}`}
                >
                  {trajectory.name}
                </h3>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    trajectory.status === "completed"
                      ? isDark
                        ? "bg-green-900/30 text-green-400"
                        : "bg-green-100 text-green-600"
                      : trajectory.status === "running"
                        ? isDark
                          ? "bg-blue-900/30 text-blue-400"
                          : "bg-blue-100 text-blue-600"
                        : isDark
                          ? "bg-red-900/30 text-red-400"
                          : "bg-red-100 text-red-600"
                  }`}
                >
                  {trajectory.status === "completed" && t("agent.completed")}
                  {trajectory.status === "running" && t("agent.running")}
                  {trajectory.status === "failed" && t("agent.error")}
                </span>
              </div>
              <div
                className={`text-sm ${isDark ? "text-gray-400" : "text-gray-500"}`}
              >
                {formatTime(trajectory.startedAt)}
                {trajectory.completedAt &&
                  ` → ${formatTime(trajectory.completedAt)}`}
              </div>
            </div>

            <div className="p-4">
              <div className="relative">
                <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700" />

                <div className="space-y-4">
                  {trajectory.steps.map((step, index) => {
                    const actionInfo = ACTION_LABELS[step.action] || {
                      label: step.action,
                      color: isDark ? "text-gray-400" : "text-gray-500",
                    };

                    return (
                      <div key={step.id} className="relative flex gap-4">
                        <div
                          className={`relative z-10 flex items-center justify-center w-8 h-8 rounded-full ${
                            isDark ? "bg-gray-700" : "bg-white"
                          } border-2 ${
                            actionInfo.color.includes("purple")
                              ? "border-purple-500"
                              : actionInfo.color.includes("blue")
                                ? "border-blue-500"
                                : actionInfo.color.includes("green")
                                  ? "border-green-500"
                                  : actionInfo.color.includes("yellow")
                                    ? "border-yellow-500"
                                    : "border-gray-300"
                          }`}
                        >
                          <span
                            className={`text-xs font-medium ${actionInfo.color}`}
                          >
                            {index + 1}
                          </span>
                        </div>

                        <div className="flex-1 pb-4">
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className={`text-sm font-medium ${actionInfo.color}`}
                            >
                              {t(actionInfo.label)}
                            </span>
                            <span
                              className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
                            >
                              {formatDuration(step.duration)}
                            </span>
                          </div>
                          <div
                            className={`text-sm mb-1 ${isDark ? "text-gray-400" : "text-gray-500"}`}
                          >
                            输入: {step.input}
                          </div>
                          <div
                            className={`text-sm ${isDark ? "text-gray-300" : "text-gray-700"}`}
                          >
                            {t("workspace.workflow")}: {step.output}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default AgentTrajectoryView;
