import { useEffect, useState, useMemo } from "react";
import { modelService } from "../../services/modelService";
import { modelSwitchService } from "../../services/modelSwitchService";
import type { ModelInfo, TaskModelConfig, TaskDefinition } from "../../types";

function TaskAssignment() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [tasks, setTasks] = useState<TaskModelConfig>({});
  const [taskDefs, setTaskDefs] = useState<TaskDefinition[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      modelService.list(),
      modelSwitchService.getTasks(),
      modelSwitchService.getTaskDefinitions(),
    ])
      .then(([modelList, taskConfig, definitions]) => {
        setModels(modelList.filter((m) => m.enabled));
        setTasks(taskConfig);
        setTaskDefs(definitions);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "加载失败");
      });
  }, []);

  /** 默认模型名（用于未设置任务的提示） */
  const defaultModelName = useMemo(() => {
    const defaultId = tasks["default" as keyof TaskModelConfig];
    if (!defaultId) return null;
    const model = models.find((m) => m.id === defaultId);
    return model?.name || model?.modelId || null;
  }, [tasks, models]);

  const modelsByProvider = useMemo(() => {
    const groups: Record<string, ModelInfo[]> = {};
    for (const m of models) {
      const p = m.provider || "other";
      if (!groups[p]) groups[p] = [];
      groups[p].push(m);
    }
    return groups;
  }, [models]);

  /** 获取指定任务类型的可选模型（Local 仅显示本地模型） */
  const getAvailableModels = (
    taskType: string,
    providerModels: ModelInfo[],
  ) => {
    if (taskType !== "local") return providerModels;
    return providerModels.filter((m) => m.requiresAuth === false);
  };

  const handleTaskChange = (type: string, modelId: string) => {
    setTasks((prev) => ({ ...prev, [type]: modelId }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await modelSwitchService.saveTasks(tasks);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    setError(null);
    try {
      // 从后端获取默认任务分工（后端无配置时返回系统默认值）
      const taskConfig = await modelSwitchService.getTasks();
      setTasks(taskConfig);
      setSaved(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "重置失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          按任务分配模型
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          为不同使用场景分配默认模型，切换任务时自动使用对应模型
        </p>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {taskDefs.map((task) => (
          <div
            key={task.type}
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 flex items-center justify-between"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-lg">{task.icon}</span>
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {task.label}
                </span>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 ml-8">
                {task.description}
              </p>
            </div>
            <div className="ml-4 shrink-0">
              <select
                value={tasks[task.type as keyof TaskModelConfig] || ""}
                onChange={(e) => handleTaskChange(task.type, e.target.value)}
                className={`px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px] ${
                  !tasks[task.type as keyof TaskModelConfig] && defaultModelName
                    ? "text-gray-400 dark:text-gray-500"
                    : ""
                }`}
              >
                <option value="">
                  — 未设置
                  {defaultModelName && task.type !== "default"
                    ? `（跟随默认: ${defaultModelName}）`
                    : ""}{" "}
                  —
                </option>
                {Object.entries(modelsByProvider).map(
                  ([provider, providerModels]) => {
                    const available = getAvailableModels(
                      task.type,
                      providerModels,
                    );
                    if (available.length === 0) return null;
                    return (
                      <optgroup key={provider} label={provider}>
                        {available.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name || m.modelId || m.id}
                          </option>
                        ))}
                      </optgroup>
                    );
                  },
                )}
              </select>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 mt-6">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors"
        >
          {saving ? "保存中..." : saved ? "✅ 已保存" : "保存策略"}
        </button>
        <button
          onClick={handleReset}
          className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
        >
          恢复默认
        </button>
      </div>
    </div>
  );
}

export default TaskAssignment;
