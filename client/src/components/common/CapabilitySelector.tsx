/**
 * 能力选择器组件
 *
 * 通用的模型能力多选组件，支持分类分组、搜索过滤、国际化显示。
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
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

export default function CapabilitySelector({
  value,
  onChange,
  disabled = false,
  showSearch = true,
  title,
  onlyEnabled = true,
  capabilities: presetCapabilities,
  categories: presetCategories,
}: CapabilitySelectorProps) {
  const { t } = useTranslation();
  const resolvedTitle = title ?? t("common.capabilityTitle");
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
        // 2026-10-16（台账 `CAPS-CAPABILITY-PRESET-CLEANUP`）：**不再注入伪造的能力列表**。
        // 原实现在此 `setCapabilities([…10 项硬编码…])` —— 属**生产代码里的假数据**（CS04），
        // 且它是服务端 28 项能力的**部分副本**（缺 18 项、无 labelKey ⇒ 只能显示英文 labelFallback，
        // `sortOrder`/`isDefault` 也是编的）⇒ 让「后端不可用」看起来像「功能正常」。
        // 现约定：加载失败 ⇒ 保持空列表（上方 handleClientError 已提示 + 下方空态呈现），不猜、不伪造；
        // 能力数据只有**一个来源**：服务端 `/v1/capabilities`（或显式传入的 `presetCapabilities`）。
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
    //
    // 分类**顺序与键集来自服务端**（`categories[].sortOrder`，真源 `CATEGORY_ORDER`）——
    // 2026-10-16（台账 `CAPS-CATEGORY-LABEL-SINGLE-SOURCE`）：原为组件内硬编码
    // `["core","vision","media","tools","special"]`，是客户端第 N 份分类键集/顺序副本。
    // 服务端列表尚未到达时，分类由下方按能力惰性建键（顺序 = 能力出现顺序），不影响功能。
    const grouped: Record<string, ModelCapabilityDefinition[]> = {};
    for (const cat of [...categories]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => c.key)) {
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
  }, [capabilities, categories, searchTerm, onlyEnabled]);

  // 获取分类显示名称
  //
  // 2026-10-16（台账 `CAPS-CATEGORY-LABEL-SINGLE-SOURCE`）：原实现**不传 `t`** ⇒ 恒走
  // `getCategoryDisplayName` 的硬编码中文兜底（en 界面也显示中文），且另有 `CATEGORY_NAME_KEYS`
  // 一套 `common.capabilityCat*` 副本。现统一走服务端下发的 `labelKey` + 客户端 i18n。
  const getCategoryName = (categoryKey: string): string =>
    capabilityService.getCategoryDisplayNameByKey(categories, categoryKey, t);

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
        {t("common.capabilityLoading")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {resolvedTitle && (
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          {resolvedTitle}
          <span className="text-gray-400 font-normal ml-1">
            {t("common.capabilitySelected", { count: value.length })}
          </span>
        </label>
      )}

      {showSearch && (
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder={t("common.capabilitySearchPlaceholder")}
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
                    {capabilityService.getDisplayName(cap, t)}
                  </label>
                ))}
              </div>
            </div>
          ))}
      </div>

      {Object.keys(filteredAndGroupedCapabilities).length === 0 && (
        <div className="py-4 text-center text-gray-400 text-sm">
          {searchTerm
            ? t("common.capabilityNoMatch")
            : t("common.capabilityNone")}
        </div>
      )}
    </div>
  );
}
