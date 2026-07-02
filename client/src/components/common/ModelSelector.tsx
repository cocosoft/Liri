/**
 * ModelSelector — 可复用模型下拉选择器
 *
 * 按 type 过滤模型列表，自动获取、缓存，支持多页面复用。
 * 替代各页面内联的 <select> 实现。
 *
 * 使用示例:
 *   <ModelSelector type="image" value={model} onChange={setModel} />
 *   <ModelSelector type={["chat", "embedding"]} onChange={handleSelect} label="模型" />
 */

import { useState, useEffect, useMemo } from "react";
import { modelService } from "../../services/modelService";
import type { ModelInfo } from "../../types/model";

export interface ModelSelectorProps {
  /** 按模型 type 过滤，支持单个或多个 */
  type: ModelInfo["type"] | ModelInfo["type"][];
  /** 当前选中模型 ID */
  value?: string;
  /** 选中回调 */
  onChange: (modelId: string) => void;
  /** 占位文案 */
  placeholder?: string;
  /** 外层 className */
  className?: string;
  /** 标签文本，不传则不显示标签 */
  label?: string;
  /** 禁用 */
  disabled?: boolean;
}

export default function ModelSelector({
  type,
  value,
  onChange,
  placeholder: _placeholder = "Select model",
  className = "",
  label,
  disabled = false,
}: ModelSelectorProps) {
  const types = Array.isArray(type) ? type : [type];
  const [allModels, setAllModels] = useState<ModelInfo[]>([]);

  useEffect(() => {
    modelService
      .list()
      .then(setAllModels)
      .catch(() => {});
  }, []);

  const filtered = useMemo(
    () => allModels.filter((m) => types.includes(m.type)),
    [allModels, types],
  );

  // 如果当前值不在过滤结果中，且过滤结果非空，选中第一个
  const effectiveValue = useMemo(() => {
    if (!value || !filtered.some((m) => m.id === value)) {
      return filtered.length > 0 ? filtered[0].id : "";
    }
    return value;
  }, [value, filtered]);

  // 同步首选项到外部
  useEffect(() => {
    if (effectiveValue && effectiveValue !== value) {
      onChange(effectiveValue);
    }
  }, [effectiveValue]);

  if (filtered.length === 0) {
    return (
      <div className={`space-y-1 ${className}`}>
        {label && (
          <div className="text-xs font-medium text-gray-400">{label}</div>
        )}
        <div className="text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-800/30 rounded px-2 py-1.5">
          No {types.join("/")} models found. Add one in Model Management.
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-1 ${className}`}>
      {label && (
        <div className="text-xs font-medium text-gray-400">{label}</div>
      )}
      <select
        value={effectiveValue}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-2 py-1.5 rounded text-xs bg-gray-800 text-gray-200 border border-gray-600/40 focus:border-blue-500/50 outline-none disabled:opacity-50"
      >
        {filtered.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  );
}
