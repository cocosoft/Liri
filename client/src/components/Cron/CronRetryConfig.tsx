import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useConfigStore } from "../../stores/configStore";
import type { CronTask } from "../../types";

interface RetryPolicy {
  taskId: string;
  taskName: string;
  enabled: boolean;
  maxRetries: number;
  retryDelay: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

interface CronRetryConfigProps {
  tasks: CronTask[];
}

function derivePolicies(tasks: CronTask[]): RetryPolicy[] {
  return tasks.map((t) => ({
    taskId: t.id,
    taskName: t.name,
    enabled: (t.consecutiveErrors ?? 0) > 0,
    maxRetries: 3,
    retryDelay: 60,
    backoffMultiplier: 2,
    retryableErrors: ["network", "timeout"],
  }));
}

function CronRetryConfig({ tasks }: CronRetryConfigProps) {
  const { t } = useTranslation();
  const { config, loadConfig } = useConfigStore();
  const isDark = config.theme === "dark";

  const [policies, setPolicies] = useState<RetryPolicy[]>(() =>
    derivePolicies(tasks),
  );
  const [selectedTask, setSelectedTask] = useState<string | null>(null);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    setPolicies(derivePolicies(tasks));
  }, [tasks]);

  const updatePolicy = (taskId: string, updates: Partial<RetryPolicy>) => {
    setPolicies((prev) =>
      prev.map((p) => (p.taskId === taskId ? { ...p, ...updates } : p)),
    );
  };

  const toggleRetry = (taskId: string) => {
    setPolicies((prev) =>
      prev.map((p) =>
        p.taskId === taskId ? { ...p, enabled: !p.enabled } : p,
      ),
    );
  };

  const removeRetryableError = (taskId: string, error: string) => {
    setPolicies((prev) =>
      prev.map((p) =>
        p.taskId === taskId
          ? { ...p, retryableErrors: p.retryableErrors.filter((e) => e !== error) }
          : p,
      ),
    );
  };

  const addRetryableError = (taskId: string, error: string) => {
    setPolicies((prev) =>
      prev.map((p) =>
        p.taskId === taskId && !p.retryableErrors.includes(error)
          ? { ...p, retryableErrors: [...p.retryableErrors, error] }
          : p,
      ),
    );
  };

  const selectedPolicy = policies.find((p) => p.taskId === selectedTask);
  const key = (k: string, fallback: string) => t(`cron.${k}`, fallback);

  const errorTypeOptions = [
    { value: "network", label: key("errorNetwork", "Network Error") },
    { value: "timeout", label: key("errorTimeout", "Timeout") },
    { value: "permission", label: key("errorPermission", "Permission Error") },
    { value: "service", label: key("errorService", "Service Unavailable") },
    { value: "resource", label: key("errorResource", "Resource Exhausted") },
  ];

  return (
    <div className="p-4">
      <h3 className="text-sm font-medium mb-4 text-gray-700 dark:text-gray-300">
        {key("retryConfigTitle", "Retry Policy Config")}
        {tasks.length > 0 && (
          <span className="ml-1 text-xs text-gray-400">({tasks.length})</span>
        )}
      </h3>

      {tasks.length === 0 ? (
        <p className="text-center text-gray-400 py-8 text-sm">
          {key("noRetryPolicies", "No cron tasks available for retry configuration")}
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <div
            className={`rounded-lg border ${isDark ? "bg-gray-700/30 border-gray-700" : "bg-gray-50 border-gray-200"} p-3`}
          >
            <h4 className={`text-xs font-medium mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}>
              {key("taskList", "Task List")}
            </h4>
            <div className="space-y-2">
              {policies.map((policy) => (
                <button
                  key={policy.taskId}
                  onClick={() => setSelectedTask(policy.taskId)}
                  className={`w-full text-left p-2 rounded text-sm transition-colors ${
                    selectedTask === policy.taskId
                      ? "bg-blue-600 text-white"
                      : isDark
                        ? "bg-gray-700 hover:bg-gray-600 text-gray-300"
                        : "bg-white hover:bg-gray-100 text-gray-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span>{policy.taskName}</span>
                    <span className={`text-xs ${policy.enabled ? "text-green-400" : "text-gray-500"}`}>
                      {policy.enabled ? "ON" : "OFF"}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div
            className={`col-span-2 rounded-lg border ${isDark ? "bg-gray-700/30 border-gray-700" : "bg-gray-50 border-gray-200"} p-3`}
          >
            {selectedPolicy ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className={`text-sm font-medium ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                    {selectedPolicy.taskName} - {key("retryPolicy", "Retry Policy")}
                  </h4>
                  <button
                    onClick={() => toggleRetry(selectedPolicy.taskId)}
                    className={`px-3 py-1 text-xs rounded-full transition-colors ${
                      selectedPolicy.enabled
                        ? "bg-green-600 text-white"
                        : isDark ? "bg-gray-600 text-gray-300" : "bg-gray-300 text-gray-700"
                    }`}
                  >
                    {selectedPolicy.enabled
                      ? key("enabled", "Enabled")
                      : key("disabled", "Disabled")}
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}>
                      {key("maxRetries", "Max Retries")}
                    </label>
                    <input
                      type="number"
                      value={selectedPolicy.maxRetries}
                      onChange={(e) =>
                        updatePolicy(selectedPolicy.taskId, { maxRetries: parseInt(e.target.value, 10) || 0 })
                      }
                      disabled={!selectedPolicy.enabled}
                      className={`w-full px-2 py-1 text-sm border rounded ${isDark ? "bg-gray-700 border-gray-600 text-white" : "bg-white border-gray-300 text-gray-900"} disabled:opacity-50`}
                    />
                  </div>
                  <div>
                    <label className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}>
                      {key("retryDelaySec", "Retry Delay (s)")}
                    </label>
                    <input
                      type="number"
                      value={selectedPolicy.retryDelay}
                      onChange={(e) =>
                        updatePolicy(selectedPolicy.taskId, { retryDelay: parseInt(e.target.value, 10) || 0 })
                      }
                      disabled={!selectedPolicy.enabled}
                      className={`w-full px-2 py-1 text-sm border rounded ${isDark ? "bg-gray-700 border-gray-600 text-white" : "bg-white border-gray-300 text-gray-900"} disabled:opacity-50`}
                    />
                  </div>
                  <div>
                    <label className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}>
                      {key("backoffMultiplier", "Backoff")}
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      value={selectedPolicy.backoffMultiplier}
                      onChange={(e) =>
                        updatePolicy(selectedPolicy.taskId, { backoffMultiplier: parseFloat(e.target.value) || 1 })
                      }
                      disabled={!selectedPolicy.enabled}
                      className={`w-full px-2 py-1 text-sm border rounded ${isDark ? "bg-gray-700 border-gray-600 text-white" : "bg-white border-gray-300 text-gray-900"} disabled:opacity-50`}
                    />
                  </div>
                </div>

                <div>
                  <label className={`block text-xs mb-2 ${isDark ? "text-gray-400" : "text-gray-600"}`}>
                    {key("retryableErrors", "Retryable Errors")}
                  </label>
                  <div className="flex flex-wrap gap-2 mb-2">
                    {selectedPolicy.retryableErrors.map((error) => (
                      <span
                        key={error}
                        className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${
                          isDark ? "bg-blue-900/30 text-blue-400" : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {errorTypeOptions.find((o) => o.value === error)?.label ?? error}
                        <button
                          onClick={() => removeRetryableError(selectedPolicy.taskId, error)}
                          disabled={!selectedPolicy.enabled}
                          className="hover:text-red-400 disabled:opacity-50"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <select
                    disabled={!selectedPolicy.enabled}
                    onChange={(e) => {
                      if (e.target.value) {
                        addRetryableError(selectedPolicy.taskId, e.target.value);
                        e.target.value = "";
                      }
                    }}
                    className={`px-2 py-1 text-sm border rounded ${isDark ? "bg-gray-700 border-gray-600 text-white" : "bg-white border-gray-300 text-gray-900"} disabled:opacity-50`}
                  >
                    <option value="">{key("addErrorType", "Add error type...")}</option>
                    {errorTypeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                <div className={`p-3 rounded-lg ${isDark ? "bg-gray-800" : "bg-white"}`}>
                  <h5 className={`text-xs font-medium mb-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}>
                    {key("retryTimeline", "Retry Timeline Example")}
                  </h5>
                  <div className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                    <span>{key("failure", "Failure")}</span>
                    {Array.from({ length: selectedPolicy.maxRetries }).map((_, i) => {
                      const delay = selectedPolicy.retryDelay * Math.pow(selectedPolicy.backoffMultiplier, i);
                      return (
                        <span key={i} className="flex items-center gap-2">
                          <span className={isDark ? "text-gray-600" : "text-gray-300"}>→</span>
                          <span className="text-blue-500">{delay}s</span>
                          <span className={isDark ? "text-gray-600" : "text-gray-300"}>→</span>
                          <span>{key("retryN", `Retry ${i + 1}`)}</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-center text-gray-400 py-8 text-sm">
                {key("selectTaskLeft", "Select a task from the left panel")}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default CronRetryConfig;
