import { useEffect, useState, useMemo } from "react";
import { modelService } from "../../services/modelService";
import { modelSwitchService } from "../../services/modelSwitchService";
import type { ModelInfo, TaskModelConfig, TaskDefinition } from "../../types";

/**
 * N-46（2026-09-20）：这些任务对应的 route 由 SmartRouter 档位解析，
 * 因此"来源标记"对它们才有意义 —— `source='user'`（用户显式保存过）时
 * 本页所选模型**优先于档位**；`'seed'`（系统播种）时实际模型由档位决定。
 * 与后端 `resolveModelRoute` 的 `EXPLICIT_CONFIG_PREFERRED_ROUTES` 保持一致。
 */
const TASK_SOURCE_AWARE_TYPES = new Set([
  "chat",
  "coding",
  "translation",
  "agent",
  "scheduled",
]);

function TaskAssignment() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [tasks, setTasks] = useState<TaskModelConfig>({});
  /** N-46：各任务的配置来源（'user' = 已显式生效 / 'seed' = 跟随档位） */
  const [sources, setSources] = useState<Record<string, "user" | "seed">>({});
  /** N-47：UUID → 模型显示名（后端已返回），用于把"不在下拉选项中的存量值"显示为真实名称 */
  const [modelNames, setModelNames] = useState<Record<string, string>>({});
  const [taskDefs, setTaskDefs] = useState<TaskDefinition[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // S3: 阶段偏好
  const [phaseMapping, setPhaseMapping] = useState<Record<string, string>>({});
  const [phaseSaving, setPhaseSaving] = useState(false);
  const [phaseSaved, setPhaseSaved] = useState(false);

  /** PDCA 阶段定义 */
  const phaseDefs = [
    {
      key: "plan",
      label: "Plan 规划",
      desc: "分析、设计、规划、调研时使用",
      icon: "📋",
    },
    {
      key: "do",
      label: "Do 执行",
      desc: "实现、写代码、修改、开发时使用",
      icon: "⚡",
    },
    {
      key: "check",
      label: "Check 审查",
      desc: "检查、验证、测试、审查时使用",
      icon: "🔍",
    },
    {
      key: "act",
      label: "Act 总结",
      desc: "优化、改进、总结、调整时使用",
      icon: "📝",
    },
  ];

  useEffect(() => {
    Promise.all([
      modelService.list(),
      modelSwitchService.getTasksWithSources(),
      modelSwitchService.getTaskDefinitions(),
      modelSwitchService.getPhaseMapping().catch(() => ({})),
    ])
      .then(([modelList, taskConfigWithSources, definitions, phaseMap]) => {
        setModels(modelList.filter((m) => m.enabled));
        setTasks(taskConfigWithSources.tasks);
        setSources(taskConfigWithSources.sources);
        setModelNames(taskConfigWithSources.modelNames);
        setTaskDefs(definitions);
        setPhaseMapping(phaseMap);
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

  /**
   * N-47：为"已配置但不在下拉选项中"的任务渲染占位 option。
   *
   * 存量值可能指向**被禁用/删除**的模型（下拉选项只取 `enabled`）⇒ 受控 `select` 的 value
   * 无匹配项时会静默回退显示首项"未设置"，用户看不到 DB 里的真实配置。此处把该值以
   * 真实模型名 + 禁用项的形式显示出来，使 UI 与 DB（数出同源）一致。
   */
  const renderOrphanModelOption = (taskType: string) => {
    const current = tasks[taskType as keyof TaskModelConfig] || "";
    if (!current) return null;
    const inOptions = Object.values(modelsByProvider).some((providerModels) =>
      getAvailableModels(taskType, providerModels).some(
        (m) => m.id === current,
      ),
    );
    if (inOptions) return null;
    return (
      <option value={current} disabled>
        已配置：{modelNames[current] || current}（当前不可用）
      </option>
    );
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
      // N-46：后端对"有值键"写入 source='user'，空串键则 deleteConfig（见 modelRouter.setTasks）
      // ⇒ 本地同步标记，无需再拉一次；用户可立即看到「显式」标记出现（数出同源可自证）。
      setSources((prev) => {
        const next = { ...prev };
        for (const [key, value] of Object.entries(tasks)) {
          if (value) next[key] = "user";
          else delete next[key];
        }
        return next;
      });
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

      const { tasks: taskConfig, sources: sourceMap } =
        await modelSwitchService.getTasksWithSources();
      setTasks(taskConfig);
      setSources(sourceMap);
      setSaved(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载默认策略失败");
    } finally {
      setSaving(false);
    }
  };

  /** S3: 阶段偏好 */
  const handleSavePhaseMapping = async () => {
    setPhaseSaving(true);
    try {
      await modelSwitchService.savePhaseMapping(phaseMapping);
      setPhaseSaved(true);
      setTimeout(() => setPhaseSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存阶段偏好失败");
    } finally {
      setPhaseSaving(false);
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
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          标记「显式」= 优先使用此处所选模型；标记「跟随档位」=
          实际模型由智能路由档位决定（保存后即转为显式）
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
                {/* N-46：来源标记（仅对由 SmartRouter 档位解析的任务类型有意义） */}
                {TASK_SOURCE_AWARE_TYPES.has(task.type) &&
                  Boolean(tasks[task.type as keyof TaskModelConfig]) && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${
                        sources[task.type] === "user"
                          ? "border-emerald-300 text-emerald-700 bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400 dark:bg-emerald-900/20"
                          : "border-gray-300 text-gray-500 bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:bg-gray-700/40"
                      }`}
                      title={
                        sources[task.type] === "user"
                          ? "已显式配置：该任务优先使用此处所选模型（优先于智能路由档位）"
                          : "系统播种值：实际模型由智能路由档位决定；保存后转为显式配置"
                      }
                    >
                      {sources[task.type] === "user" ? "显式" : "跟随档位"}
                    </span>
                  )}
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
                {/* N-47：存量值不在选项中（模型被禁用/删除）时显示真实值，避免静默回退为"未设置" */}
                {renderOrphanModelOption(task.type)}
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

      {/* P3 role 路由 — 编排角色（候选生成 / 对抗批评）专用模型；未设置跟随各任务/默认 */}
      <div className="mt-6">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
          🎭 角色分工
          <span className="text-xs text-gray-400 font-normal">
            研究/验证编排的专用模型（未设置时跟随默认模型）
          </span>
        </h3>
        <div className="space-y-2">
          {[
            {
              key: "generator" as keyof TaskModelConfig,
              label: "候选生成",
              desc: "研究模式多视角候选方案生成（不宜弱于中档模型）",
              icon: "🧪",
            },
            {
              key: "verifier" as keyof TaskModelConfig,
              label: "对抗批评",
              desc: "研究候选对抗评审 / 验证环节（建议用强档）",
              icon: "🛡️",
            },
          ].map((role) => (
            <div
              key={role.key}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 flex items-center justify-between"
            >
              <div className="min-w-0 flex items-center gap-2">
                <span className="text-lg">{role.icon}</span>
                <div>
                  <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                    {role.label}
                  </span>
                  <p className="text-xs text-gray-400">{role.desc}</p>
                </div>
              </div>
              <select
                value={tasks[role.key] || ""}
                onChange={(e) => handleTaskChange(role.key, e.target.value)}
                className={`ml-4 shrink-0 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px] ${
                  !tasks[role.key] ? "text-gray-400 dark:text-gray-500" : ""
                }`}
              >
                <option value="">
                  — 未设置
                  {defaultModelName
                    ? `（跟随默认: ${defaultModelName}）`
                    : ""}{" "}
                  —
                </option>
                {Object.entries(modelsByProvider).map(
                  ([provider, providerModels]) => {
                    const available = getAvailableModels(
                      "chat",
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
          ))}
        </div>
      </div>

      {/* S3: 阶段偏好 — 配置每个 PDCA 阶段应使用哪个任务类型的模型 */}
      <div className="mt-6">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
          🔄 阶段偏好
          <span className="text-xs text-gray-400 font-normal">
            自动检测对话阶段，切换到对应模型
          </span>
        </h3>
        <div className="space-y-2">
          {phaseDefs.map((phase) => (
            <div
              key={phase.key}
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 flex items-center justify-between"
            >
              <div className="min-w-0 flex items-center gap-2">
                <span className="text-lg">{phase.icon}</span>
                <div>
                  <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                    {phase.label}
                  </span>
                  <p className="text-xs text-gray-400">{phase.desc}</p>
                </div>
              </div>
              <select
                value={phaseMapping[phase.key] || ""}
                onChange={(e) => {
                  const next = { ...phaseMapping, [phase.key]: e.target.value };
                  if (!e.target.value) delete next[phase.key];
                  setPhaseMapping(next);
                }}
                className={`ml-4 shrink-0 px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[200px] ${
                  !phaseMapping[phase.key]
                    ? "text-gray-400 dark:text-gray-500"
                    : ""
                }`}
              >
                <option value="">— 默认 —</option>
                {Object.entries(modelsByProvider).map(
                  ([provider, providerModels]) => {
                    const available = getAvailableModels(
                      phase.key,
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
          ))}
        </div>
        <div className="mt-3">
          <button
            onClick={handleSavePhaseMapping}
            disabled={phaseSaving}
            className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white rounded-lg transition-colors"
          >
            {phaseSaving
              ? "保存中..."
              : phaseSaved
                ? "✅ 已保存"
                : "保存阶段偏好"}
          </button>
        </div>
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
