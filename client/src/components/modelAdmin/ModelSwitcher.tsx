import { useEffect, useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useModelSwitchStore } from "../../stores/modelSwitchStore";
import { modelService } from "../../services/modelService";
import { modelSwitchService } from "../../services/modelSwitchService";
import { balanceService } from "../../services/balanceService";
import { useSessionStore } from "../../stores/sessionStore";
import type { ModelInfo, BalanceRecord } from "../../types";

interface ModelSwitcherProps {
  onClose: () => void;
}

const PROVIDER_COLORS: Record<string, string> = {
  deepseek: "text-red-600 dark:text-red-400",
  openai: "text-green-600 dark:text-green-400",
  google: "text-blue-600 dark:text-blue-400",
  qwen: "text-indigo-600 dark:text-indigo-400",
  ollama: "text-orange-600 dark:text-orange-400",
};

function getProviderColor(provider: string): string {
  return (
    PROVIDER_COLORS[provider.toLowerCase()] ||
    "text-gray-600 dark:text-gray-400"
  );
}

function ModelSwitcher({ onClose }: ModelSwitcherProps) {
  const navigate = useNavigate();
  const { currentModelId, switchModel, tasks } = useModelSwitchStore();
  // 读取当前会话的任务分工覆盖（用于"按任务"视图区分全局/会话级配置）
  const currentSession = useSessionStore((s) => s.currentSession);
  const sessionTasks = currentSession?.tasksOverride;
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [groupBy, setGroupBy] = useState<"provider" | "task">("provider");
  const [balances, setBalances] = useState<BalanceRecord[]>([]);

  useEffect(() => {
    modelService
      .list()
      .then((all) => setModels(all.filter((m) => m.type === "chat")))
      .catch(() => {});
    balanceService.batchCheck().then(setBalances).catch(() => {});
  }, []);

  const filteredModels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.modelId?.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.provider.toLowerCase().includes(q),
    );
  }, [models, searchQuery]);

  const groupedByProvider = useMemo(() => {
    const groups: Record<string, ModelInfo[]> = {};
    for (const m of filteredModels) {
      const p = m.provider || "other";
      if (!groups[p]) groups[p] = [];
      groups[p].push(m);
    }
    return groups;
  }, [filteredModels]);

  const handleSwitch = useCallback(
    async (modelId: string) => {
      await switchModel(modelId);

      // 【写回路径】将模型选择绑定到当前会话
      try {
        // 动态 import 避免循环依赖
        const { useSessionStore } = await import("../../stores/sessionStore");
        const { sessionService } = await import("../../services/sessionService");
        const sessionState = useSessionStore.getState();
        const currentSession = sessionState.currentSession;
        if (currentSession) {
          // 更新本地会话缓存
          useSessionStore.setState({
            currentSession: { ...currentSession, modelId },
            sessions: sessionState.sessions.map((s) =>
              s.id === currentSession.id ? { ...s, modelId } : s
            ),
          });
          // 尝试持久化到后端（PATCH API 不存在时静默降级）
          await sessionService.updateSessionMeta(currentSession.id, { modelId });
        }
      } catch {
        // 静默降级
      }

      onClose();
    },
    [switchModel, onClose],
  );

  const currentTaskType = useMemo(() => {
    for (const [type, modelId] of Object.entries(tasks)) {
      if (modelId === currentModelId) return type;
    }
    return null;
  }, [tasks, currentModelId]);

  const [taskDefs, setTaskDefs] = useState<Array<{ type: string; label: string; icon: string }>>([]);
  useEffect(() => {
    modelSwitchService.getTaskDefinitions().then(setTaskDefs).catch(() => {});
  }, []);

  const taskLabels = useMemo(() => {
    const map: Record<string, string> = {};
    for (const d of taskDefs) {
      map[d.type] = `${d.icon} ${d.label}`;
    }
    return map;
  }, [taskDefs]);

  const balanceByProvider = useMemo(() => {
    const map = new Map<string, BalanceRecord>();
    for (const b of balances) {
      const key = b.providerType.toLowerCase();
      // 优先保留有余额数据的记录
      if (!map.has(key) || b.remaining !== null) {
        map.set(key, b);
      }
    }
    return map;
  }, [balances]);

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div
        className="absolute left-16 bottom-12 w-96 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl z-50 max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 搜索 */}
        <div className="p-3 border-b border-gray-200 dark:border-gray-700">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索模型..."
            className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400"
            autoFocus
          />
        </div>

        {/* Tab: 按提供商 / 按任务 */}
        <div className="flex gap-1 px-3 pt-2">
          <button
            onClick={() => setGroupBy("provider")}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${groupBy === "provider" ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}
          >
            按提供商
          </button>
          <button
            onClick={() => setGroupBy("task")}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${groupBy === "task" ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium" : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"}`}
          >
            按任务
          </button>
        </div>

        {/* 列表 */}
        <div className="flex-1 overflow-y-auto p-2">
          {groupBy === "task" ? (
            <div className="space-y-1">
              {Object.entries(taskLabels).map(([type, label]) => {
                // 优先使用会话级覆盖，无覆盖时使用全局配置
                const sessionModelId = (sessionTasks as Record<string, string | undefined> | undefined)?.[type];
                const globalModelId = (tasks as Record<string, string | undefined>)[type];
                const effectiveModelId = sessionModelId || globalModelId;
                const model = models.find((m) => m.id === effectiveModelId);
                const isSessionOverride = !!sessionModelId;
                return (
                  <div
                    key={type}
                    className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{label}</span>
                      {model && (
                        <span
                          className={`text-xs ${getProviderColor(model.provider)}`}
                        >
                          {model.name || model.modelId || model.id}
                        </span>
                      )}
                      {isSessionOverride && (
                        <span className="text-[10px] text-blue-500 font-medium border border-blue-200 dark:border-blue-700 rounded px-1">
                          会话
                        </span>
                      )}
                    </div>
                    {type === currentTaskType && (
                      <span className="text-xs text-blue-500 font-medium">
                        当前
                      </span>
                    )}
                  </div>
                );
              })}
              <div className="border-t border-gray-200 dark:border-gray-700 my-2" />
              {filteredModels.map((model) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  isActive={model.id === currentModelId}
                  onSelect={handleSwitch}
                />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {Object.entries(groupedByProvider).map(
                ([provider, providerModels]) => (
                  <div key={provider}>
                    <div className="flex items-center justify-between px-3 py-1">
                      <span
                        className={`text-xs font-medium ${getProviderColor(provider)}`}
                      >
                        {provider}
                      </span>
                      {(() => {
                        const bal = balanceByProvider.get(provider.toLowerCase());
                        if (!bal) return null;
                        return (
                          <span className={`text-xs font-mono ${
                            bal.belowThreshold
                              ? "text-red-500 dark:text-red-400"
                              : bal.remaining !== null
                                ? "text-gray-500 dark:text-gray-400"
                                : "text-gray-400 dark:text-gray-500"
                          }`}>
                            {bal.remaining !== null
                              ? `${bal.remaining.toFixed(2)} ${bal.unit}`
                              : bal.supported ? "--" : "暂不支持"}
                          </span>
                        );
                      })()}
                    </div>
                    {providerModels.map((model) => (
                      <ModelRow
                        key={model.id}
                        model={model}
                        isActive={model.id === currentModelId}
                        onSelect={handleSwitch}
                      />
                    ))}
                  </div>
                ),
              )}
            </div>
          )}
        </div>

        {/* 底部链接 */}
        <div className="p-2 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={() => {
              navigate("/models");
              onClose();
            }}
            className="w-full px-3 py-2 text-xs text-center text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg transition-colors"
          >
            ⚙ 管理模型
          </button>
        </div>
      </div>
    </div>
  );
}

function ModelRow({
  model,
  isActive,
  onSelect,
}: {
  model: ModelInfo;
  isActive: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onSelect(model.id)}
      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors ${
        isActive
          ? "bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
          : "hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-700 dark:text-gray-300"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`text-xs font-medium shrink-0 ${getProviderColor(model.provider)}`}
        >
          {model.provider}
        </span>
        <span className="text-sm truncate">{model.name || model.modelId || model.id}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isActive && (
          <span className="text-xs text-blue-500 font-medium">● 当前</span>
        )}
      </div>
    </button>
  );
}

export default ModelSwitcher;
