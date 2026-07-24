/**
 * 能力选择器组件
 *
 * 通用的模型能力多选组件，支持分类分组、搜索过滤、国际化显示。
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { capabilityService } from "../../services/capabilityService";
import { handleClientError } from "../../utils/handleError";
import type {
  ModelCapabilityDefinition,
  CapabilityCategoryDefinition,
} from "../../services/capabilityService";

interface CapabilitySelectorProps {
  /** 当前选中的能力 key 列表 */
  value: string[];
  /** 选中变化回调 */
  onChange: (values: string[]) => void;
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否显示搜索框 */
  showSearch?: boolean;
  /** 自定义标题 */
  title?: string;
  /** 是否只显示启用的能力 */
  onlyEnabled?: boolean;
  /** 预设的能力列表（用于不依赖服务端的场景） */
  capabilities?: ModelCapabilityDefinition[];
  /** 预设的分类列表 */
  categories?: CapabilityCategoryDefinition[];
  /** 是否强制刷新 */
  forceRefresh?: boolean;
}

const CATEGORY_NAMES: Record<string, string> = {
  core: "核心能力",
  vision: "视觉能力",
  media: "媒体能力",
  tools: "工具能力",
  special: "特殊能力",
};

export default function CapabilitySelector({
  value,
  onChange,
  disabled = false,
  showSearch = true,
  title = "能力",
  onlyEnabled = true,
  capabilities: presetCapabilities,
  categories: presetCategories,
}: CapabilitySelectorProps) {
  const [capabilities, setCapabilities] = useState<ModelCapabilityDefinition[]>(
    [],
  );
  const [categories, setCategories] = useState<CapabilityCategoryDefinition[]>(
    [],
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(true);

  // 加载能力列表
  useEffect(() => {
    const loadCapabilities = async () => {
      setLoading(true);
      try {
        if (presetCapabilities) {
          setCapabilities(presetCapabilities);
          setCategories(presetCategories || []);
        } else {
          const result = await capabilityService.getAll();
          setCapabilities(result.capabilities);
          setCategories(result.categories);
        }
      } catch (err) {
        handleClientError(err, {
          module: "components:common:CapabilitySelector",
          action: "loadCapabilities",
        });
        // 使用基础 fallback 列表
        setCapabilities([
          {
            key: "streaming",
            labelFallback: "Streaming",
            isDefault: true,
            enabled: true,
            category: "core",
            sortOrder: 1,
          } as ModelCapabilityDefinition,
          {
            key: "function_calling",
            labelFallback: "Function Calling",
            isDefault: true,
            enabled: true,
            category: "core",
            sortOrder: 2,
          } as ModelCapabilityDefinition,
          {
            key: "tool_use",
            labelFallback: "Tool Use",
            isDefault: true,
            enabled: true,
            category: "tools",
            sortOrder: 1,
          } as ModelCapabilityDefinition,
          {
            key: "vision",
            labelFallback: "Vision",
            isDefault: false,
            enabled: true,
            category: "vision",
            sortOrder: 1,
          } as ModelCapabilityDefinition,
          {
            key: "image_generation",
            labelFallback: "Image Generation",
            isDefault: false,
            enabled: true,
            category: "media",
            sortOrder: 1,
          } as ModelCapabilityDefinition,
          {
            key: "text_to_speech",
            labelFallback: "Text to Speech",
            isDefault: false,
            enabled: true,
            category: "media",
            sortOrder: 2,
          } as ModelCapabilityDefinition,
          {
            key: "speech_recognition",
            labelFallback: "Speech Recognition",
            isDefault: false,
            enabled: true,
            category: "media",
            sortOrder: 3,
          } as ModelCapabilityDefinition,
          {
            key: "embedding",
            labelFallback: "Embedding",
            isDefault: false,
            enabled: true,
            category: "special",
            sortOrder: 1,
          } as ModelCapabilityDefinition,
          {
            key: "structured_output",
            labelFallback: "Structured Output",
            isDefault: false,
            enabled: true,
            category: "core",
            sortOrder: 3,
          } as ModelCapabilityDefinition,
          {
            key: "thinking",
            labelFallback: "Thinking",
            isDefault: false,
            enabled: true,
            category: "special",
            sortOrder: 2,
          } as ModelCapabilityDefinition,
        ]);
      } finally {
        setLoading(false);
      }
    };
    loadCapabilities();
  }, [presetCapabilities, presetCategories]);

  // 过滤和分组能力
  const filteredAndGroupedCapabilities = useMemo(() => {
    let filtered = capabilities;

    // 按启用状态过滤
    if (onlyEnabled) {
      filtered = filtered.filter((c) => c.enabled);
    }

    // 按搜索词过滤
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.key.toLowerCase().includes(term) ||
          c.labelFallback.toLowerCase().includes(term) ||
          (c.descriptionFallback &&
            c.descriptionFallback.toLowerCase().includes(term)),
      );
    }

    // 按分类分组
    const grouped: Record<string, ModelCapabilityDefinition[]> = {};
    const categoryOrder = ["core", "vision", "media", "tools", "special"];

    // 初始化分类
    for (const cat of categoryOrder) {
      grouped[cat] = [];
    }

    // 添加其他分类
    for (const cap of filtered) {
      if (!grouped[cap.category]) {
        grouped[cap.category] = [];
      }
      grouped[cap.category].push(cap);
    }

    // 排序
    for (const cat in grouped) {
      grouped[cat].sort((a, b) => a.sortOrder - b.sortOrder);
    }

    return grouped;
  }, [capabilities, searchTerm, onlyEnabled]);

  // 获取分类显示名称
  const getCategoryName = (categoryKey: string): string => {
    // 优先从 categories 列表获取
    const cat = categories.find((c) => c.key === categoryKey);
    if (cat) {
      return capabilityService.getCategoryDisplayName(cat);
    }
    // 回退到硬编码映射
    return CATEGORY_NAMES[categoryKey] || categoryKey;
  };

  // 切换能力选中状态
  const toggleCapability = useCallback(
    (capKey: string) => {
      if (disabled) return;

      const newValue = value.includes(capKey)
        ? value.filter((k) => k !== capKey)
        : [...value, capKey];

      onChange(newValue);
    },
    [value, onChange, disabled],
  );

  // 全选/取消全选分类
  const toggleCategory = useCallback(
    (categoryKey: string) => {
      if (disabled) return;

      const catCaps = filteredAndGroupedCapabilities[categoryKey];
      if (!catCaps || catCaps.length === 0) return;

      const catKeys = catCaps.map((c) => c.key);
      const allSelected = catKeys.every((k) => value.includes(k));

      if (allSelected) {
        // 取消全选
        const newValue = value.filter((k) => !catKeys.includes(k));
        onChange(newValue);
      } else {
        // 全选
        const newValue = [...new Set([...value, ...catKeys])];
        onChange(newValue);
      }
    },
    [filteredAndGroupedCapabilities, value, onChange, disabled],
  );

  // 检查分类是否全选
  const isCategorySelected = useCallback(
    (categoryKey: string): boolean => {
      const catCaps = filteredAndGroupedCapabilities[categoryKey];
      if (!catCaps || catCaps.length === 0) return false;
      return catCaps.every((c) => value.includes(c.key));
    },
    [filteredAndGroupedCapabilities, value],
  );

  if (loading) {
    return (
      <div className="py-4 text-center text-gray-400 text-sm">
        加载能力列表中...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {title && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {title}
          <span className="text-gray-400 font-normal ml-1">
            ({value.length} 已选)
          </span>
        </label>
      )}

      {showSearch && (
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="搜索能力..."
          className="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={disabled}
        />
      )}

      <div className="space-y-3">
        {Object.entries(filteredAndGroupedCapabilities)
          .filter(([, caps]) => caps.length > 0)
          .map(([category, caps]) => (
            <div
              key={category}
              className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3"
            >
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => toggleCategory(category)}
                  disabled={disabled}
                  className="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 transition-colors disabled:opacity-50"
                >
                  <input
                    type="checkbox"
                    checked={isCategorySelected(category)}
                    onChange={() => {}}
                    className="rounded"
                    disabled={disabled}
                  />
                  {getCategoryName(category)}
                  <span className="text-gray-400">({caps.length})</span>
                </button>
              </div>

              <div className="flex flex-wrap gap-2">
                {caps.map((cap) => (
                  <label
                    key={cap.key}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer transition-colors ${
                      value.includes(cap.key)
                        ? "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800"
                        : "bg-white dark:bg-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-500 border border-gray-200 dark:border-gray-500"
                    } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={value.includes(cap.key)}
                      onChange={() => toggleCapability(cap.key)}
                      disabled={disabled}
                      className="rounded"
                    />
                    {capabilityService.getDisplayName(cap)}
                  </label>
                ))}
              </div>
            </div>
          ))}
      </div>

      {Object.keys(filteredAndGroupedCapabilities).length === 0 && (
        <div className="py-4 text-center text-gray-400 text-sm">
          {searchTerm ? "未找到匹配的能力" : "暂无可用能力"}
        </div>
      )}
    </div>
  );
}
