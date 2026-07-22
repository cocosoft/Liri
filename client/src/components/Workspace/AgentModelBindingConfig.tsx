/**
 * Agent-Model 绑定配置组件
 *
 * 可视化配置 Agent 角色与模型的绑定关系：
 * - 每个 Agent 角色可以选择不同的模型
 * - 配置最大 Token 数、温度等参数
 * - 实时预览可用模型列表
 */

import { useState, useEffect } from "react";
import { workspaceService } from "../../services/workspaceService";
import { createLogger } from "@/utils/logger";

const logger = createLogger("components:agentModelBinding");

import { useTranslation } from "react-i18next";

// ========== 类型定义 ==========

/** Agent 模型绑定 */
interface AgentModelBinding {
  agentRole: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

/** 可用模型 */
interface AvailableModel {
  id: string;
  name: string;
  provider: string;
}

// ========== 组件 Props ==========

interface AgentModelBindingConfigProps {
  workspaceId: string;
  isDark: boolean;
}

/** Agent 角色中文名 */
const ROLE_LABELS: Record<string, string> = {
  default: "默认 Agent",
  coder: "编码 Agent",
  reviewer: "审核 Agent",
  researcher: "研究 Agent",
  coordinator: "协调 Agent",
  planner: "规划 Agent",
  tester: "测试 Agent",
};

/**
 * Agent-Model 绑定配置组件
 */
function AgentModelBindingConfig({
  workspaceId,
  isDark,
}: AgentModelBindingConfigProps) {
  const { t } = useTranslation();
  const [bindings, setBindings] = useState<AgentModelBinding[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // 加载配置
  useEffect(() => {
    loadBindings();
  }, [workspaceId]);

  const loadBindings = async () => {
    setLoading(true);
    try {
      const result = await workspaceService.getAgentModelBindings(workspaceId);
      setBindings(result.bindings);
      setAvailableModels(result.availableModels);
    } catch (err) {
      logger.warn("加载配置失败", err);
      setMessage({ type: "error", text: "加载配置失败" });
    } finally {
      setLoading(false);
    }
  };

  // 更新绑定
  const updateBinding = (
    index: number,
    field: keyof AgentModelBinding,
    value: string | number,
  ) => {
    setBindings((prev) =>
      prev.map((b, i) => (i === index ? { ...b, [field]: value } : b)),
    );
  };

  // 保存
  const handleSave = async () => {
    setSaving(true);
    try {
      await workspaceService.updateAgentModelBindings(workspaceId, {
        bindings,
      });
      setMessage({ type: "success", text: "保存成功" });
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      logger.warn("保存失败", err);
      setMessage({ type: "error", text: "保存失败" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div
        className={`p-4 text-center ${isDark ? "text-gray-400" : "text-gray-500"}`}
      >
        加载中...
      </div>
    );
  }

  return (
    <div className={`p-4 ${isDark ? "text-gray-200" : "text-gray-800"}`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Agent-Model 绑定配置</h3>
          <p className="text-sm text-gray-500 mt-1">{t("agent.config")}</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 disabled:opacity-50 transition-colors"
        >
          {saving ? "保存中..." : "保存"}
        </button>
      </div>

      {message && (
        <div
          className={`mb-3 p-2 rounded text-sm ${
            message.type === "success"
              ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"
          }`}
        >
          {message.text}
        </div>
      )}

      <div className="space-y-4">
        {bindings.map((binding, index) => (
          <div
            key={binding.agentRole}
            className={`p-4 rounded-lg border ${
              isDark
                ? "border-gray-700 bg-gray-800"
                : "border-gray-200 bg-white"
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              <span className="text-sm font-medium w-24">
                {ROLE_LABELS[binding.agentRole] || binding.agentRole}
              </span>
              <span className="text-xs text-gray-500 font-mono">
                {binding.agentRole}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* 模型选择 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">模型</label>
                <select
                  value={binding.model}
                  onChange={(e) =>
                    updateBinding(index, "model", e.target.value)
                  }
                  className={`w-full p-2 rounded text-sm border ${
                    isDark
                      ? "bg-gray-700 border-gray-600 text-gray-200"
                      : "bg-white border-gray-300 text-gray-800"
                  }`}
                >
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.provider})
                    </option>
                  ))}
                </select>
              </div>

              {/* 最大 Token */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  {t("workspace.cost")}
                </label>
                <input
                  type="number"
                  value={binding.maxTokens}
                  onChange={(e) =>
                    updateBinding(
                      index,
                      "maxTokens",
                      parseInt(e.target.value) || 4096,
                    )
                  }
                  min={256}
                  max={128000}
                  step={256}
                  className={`w-full p-2 rounded text-sm border ${
                    isDark
                      ? "bg-gray-700 border-gray-600 text-gray-200"
                      : "bg-white border-gray-300 text-gray-800"
                  }`}
                />
              </div>

              {/* 温度 */}
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  温度: {binding.temperature}
                </label>
                <input
                  type="range"
                  value={binding.temperature}
                  onChange={(e) =>
                    updateBinding(
                      index,
                      "temperature",
                      parseFloat(e.target.value),
                    )
                  }
                  min={0}
                  max={2}
                  step={0.1}
                  className="w-full"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default AgentModelBindingConfig;
export type { AgentModelBinding, AvailableModel };
