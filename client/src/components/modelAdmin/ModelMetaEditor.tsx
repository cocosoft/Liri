import { useState, useEffect, useMemo } from "react";
import { modelAdminService } from "../../services/modelAdminService";
import { configService } from "../../services/configService";
import { capabilityService } from "../../services/capabilityService";
import type { ModelCapabilityDefinition } from "../../services/capabilityService";

interface ModelMetaEditorProps {
  modelId: string;
  modelName: string;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  displayName: string;
  contextWindow: string;
  maxOutputTokens: string;
  inputPrice: string;
  outputPrice: string;
  cacheReadPrice: string;
  cacheWritePrice: string;
  capabilities: string[];
}

function ModelMetaEditor({
  modelId,
  modelName,
  onClose,
  onSaved,
}: ModelMetaEditorProps) {
  const [form, setForm] = useState<FormState>({
    displayName: modelName,
    contextWindow: "200000",
    maxOutputTokens: "16384",
    inputPrice: "",
    outputPrice: "",
    cacheReadPrice: "",
    cacheWritePrice: "",
    capabilities: [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [capabilities, setCapabilities] = useState<ModelCapabilityDefinition[]>([]);
  const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false);

  // 加载已有的模型覆盖配置
  useEffect(() => {
    const loadOverrides = async () => {
      try {
        const baseKey = `models.overrides.${modelId}`;
        const all = await configService.list();
        const prefix = `${baseKey}.`;
        const existing: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(all)) {
          if (k.startsWith(prefix)) {
            existing[k.slice(prefix.length)] = v;
          }
        }
        if (Object.keys(existing).length > 0) {
          setForm((prev) => ({
            ...prev,
            displayName: (existing.displayName as string) || prev.displayName,
            contextWindow: String(existing.contextWindow || prev.contextWindow),
            maxOutputTokens: String(
              existing.maxOutputTokens || prev.maxOutputTokens,
            ),
            inputPrice:
              typeof existing.pricing === "object" && existing.pricing
                ? String(
                    (existing.pricing as Record<string, number>).inputPer1M ||
                      "",
                  )
                : "",
            outputPrice:
              typeof existing.pricing === "object" && existing.pricing
                ? String(
                    (existing.pricing as Record<string, number>).outputPer1M ||
                      "",
                  )
                : "",
            cacheReadPrice:
              typeof existing.pricing === "object" && existing.pricing
                ? String(
                    (existing.pricing as Record<string, number>)
                      .cacheReadPer1M || "",
                  )
                : "",
            cacheWritePrice:
              typeof existing.pricing === "object" && existing.pricing
                ? String(
                    (existing.pricing as Record<string, number>)
                      .cacheWritePer1M || "",
                  )
                : "",
            capabilities: Array.isArray(existing.capabilities)
              ? (existing.capabilities as string[])
              : prev.capabilities,
          }));
        }
      } catch {
        // 加载失败使用默认值
      } finally {
        setLoaded(true);
      }
    };
    loadOverrides();
  }, [modelId]);

  // 加载能力定义列表（从服务端动态获取）
  useEffect(() => {
    const loadCapabilities = async () => {
      try {
        const result = await capabilityService.getCapabilitiesCached();
        setCapabilities(result);
        
        // 如果表单中没有设置能力，使用默认能力
        setForm((prev) => {
          if (prev.capabilities.length === 0) {
            const defaultCaps = result.filter((c) => c.isDefault).map((c) => c.key);
            return { ...prev, capabilities: defaultCaps.length > 0 ? defaultCaps : ["streaming", "function_calling", "tool_use"] };
          }
          return prev;
        });
      } catch {
        // 加载失败使用基础能力列表作为 fallback
        setCapabilities([
          { key: "streaming", labelFallback: "Streaming", isDefault: true, enabled: true, category: "core" } as ModelCapabilityDefinition,
          { key: "function_calling", labelFallback: "Function Calling", isDefault: true, enabled: true, category: "core" } as ModelCapabilityDefinition,
          { key: "vision", labelFallback: "Vision", isDefault: false, enabled: true, category: "vision" } as ModelCapabilityDefinition,
          { key: "thinking", labelFallback: "Thinking", isDefault: false, enabled: true, category: "special" } as ModelCapabilityDefinition,
          { key: "tool_use", labelFallback: "Tool Use", isDefault: true, enabled: true, category: "tools" } as ModelCapabilityDefinition,
          { key: "structured_output", labelFallback: "Structured Output", isDefault: false, enabled: true, category: "core" } as ModelCapabilityDefinition,
          { key: "image_input", labelFallback: "Image Input", isDefault: false, enabled: true, category: "vision" } as ModelCapabilityDefinition,
          { key: "pdf_input", labelFallback: "PDF Input", isDefault: false, enabled: true, category: "tools" } as ModelCapabilityDefinition,
        ]);
        if (!form.capabilities || form.capabilities.length === 0) {
          setForm((prev) => ({ ...prev, capabilities: ["streaming", "function_calling", "tool_use"] }));
        }
      } finally {
        setCapabilitiesLoaded(true);
      }
    };
    loadCapabilities();
  }, []);

  // 将能力按分类分组
  const capabilitiesByCategory = useMemo(() => {
    const grouped: Record<string, ModelCapabilityDefinition[]> = {};
    const categoryOrder = ["core", "vision", "media", "tools", "special"];
    
    for (const cat of categoryOrder) {
      grouped[cat] = [];
    }
    
    for (const cap of capabilities) {
      if (grouped[cap.category]) {
        grouped[cap.category].push(cap);
      } else {
        grouped[cap.category] = [cap];
      }
    }
    
    // 按 sortOrder 排序
    for (const cat in grouped) {
      grouped[cat].sort((a, b) => a.sortOrder - b.sortOrder);
    }
    
    return grouped;
  }, [capabilities]);

  // 获取分类显示名称
  const getCategoryName = (categoryKey: string): string => {
    const names: Record<string, string> = {
      core: "核心能力",
      vision: "视觉能力",
      media: "媒体能力",
      tools: "工具能力",
      special: "特殊能力",
    };
    return names[categoryKey] || categoryKey;
  };

  const handleChange = (field: keyof FormState, value: string | string[]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleCapability = (cap: string) => {
    setForm((prev) => ({
      ...prev,
      capabilities: prev.capabilities.includes(cap)
        ? prev.capabilities.filter((c) => c !== cap)
        : [...prev.capabilities, cap],
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const overrides: Record<string, unknown> = {};
      if (form.displayName && form.displayName !== modelName)
        overrides.displayName = form.displayName;
      const cw = parseInt(form.contextWindow);
      if (!isNaN(cw) && cw !== 200000) overrides.contextWindow = cw;
      const mot = parseInt(form.maxOutputTokens);
      if (!isNaN(mot) && mot !== 16384) overrides.maxOutputTokens = mot;
      if (form.inputPrice || form.outputPrice) {
        overrides.pricing = {};
        if (form.inputPrice)
          (overrides.pricing as Record<string, number>).inputPer1M = parseFloat(
            form.inputPrice,
          );
        if (form.outputPrice)
          (overrides.pricing as Record<string, number>).outputPer1M =
            parseFloat(form.outputPrice);
        if (form.cacheReadPrice)
          (overrides.pricing as Record<string, number>).cacheReadPer1M =
            parseFloat(form.cacheReadPrice);
        if (form.cacheWritePrice)
          (overrides.pricing as Record<string, number>).cacheWritePer1M =
            parseFloat(form.cacheWritePrice);
      }
      overrides.capabilities = form.capabilities;

      await modelAdminService.saveModelOverride(modelId, overrides);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await modelAdminService.deleteModelOverride(modelId);
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "恢复默认失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {!loaded || !capabilitiesLoaded ? (
          <div className="py-8 text-center text-gray-400 text-sm">
            加载中...
          </div>
        ) : (
          <>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
              编辑模型: {modelId}
            </h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
              修改后将覆盖内置默认值
            </p>

            {error && (
              <div className="mb-4 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-xs">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  显示名称
                </label>
                <input
                  type="text"
                  value={form.displayName}
                  onChange={(e) => handleChange("displayName", e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    上下文窗口
                  </label>
                  <input
                    type="number"
                    value={form.contextWindow}
                    onChange={(e) =>
                      handleChange("contextWindow", e.target.value)
                    }
                    className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    最大输出 Token
                  </label>
                  <input
                    type="number"
                    value={form.maxOutputTokens}
                    onChange={(e) =>
                      handleChange("maxOutputTokens", e.target.value)
                    }
                    className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  定价（$ / 1M tokens）
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      输入
                    </label>
                    <input
                      type="text"
                      value={form.inputPrice}
                      onChange={(e) =>
                        handleChange("inputPrice", e.target.value)
                      }
                      placeholder="如: 3.0"
                      className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      输出
                    </label>
                    <input
                      type="text"
                      value={form.outputPrice}
                      onChange={(e) =>
                        handleChange("outputPrice", e.target.value)
                      }
                      placeholder="如: 15.0"
                      className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      缓存读
                    </label>
                    <input
                      type="text"
                      value={form.cacheReadPrice}
                      onChange={(e) =>
                        handleChange("cacheReadPrice", e.target.value)
                      }
                      placeholder="如: 0.3"
                      className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                      缓存写
                    </label>
                    <input
                      type="text"
                      value={form.cacheWritePrice}
                      onChange={(e) =>
                        handleChange("cacheWritePrice", e.target.value)
                      }
                      placeholder="如: 3.75"
                      className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  能力
                </label>
                <div className="space-y-3">
                  {Object.entries(capabilitiesByCategory)
                    .filter(([, caps]) => caps.length > 0)
                    .map(([category, caps]) => (
                      <div key={category}>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                          {getCategoryName(category)}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {caps.map((cap) => (
                            <label
                              key={cap.key}
                              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer transition-colors ${
                                form.capabilities.includes(cap.key)
                                  ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800"
                                  : "bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={form.capabilities.includes(cap.key)}
                                onChange={() => toggleCapability(cap.key)}
                                className="rounded"
                              />
                              {capabilityService.getDisplayName(cap)}
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>

            <div className="flex justify-between mt-6">
              <button
                onClick={handleReset}
                disabled={saving}
                className="px-3 py-2 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-lg transition-colors disabled:opacity-50"
              >
                恢复默认
              </button>
              <div className="flex gap-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white rounded-lg transition-colors"
                >
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ModelMetaEditor;
