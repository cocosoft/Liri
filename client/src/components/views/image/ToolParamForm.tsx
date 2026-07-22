/**
 * ToolParamForm
 * 通用工具参数表单 — 根据工具名动态渲染参数控件（全 i18n）
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { getToolSchema } from "./toolRegistry";

export interface ToolParam {
  name: string;
  type: "string" | "number" | "boolean" | "array";
  enum?: string[];
  descriptionKey: string;
  required: boolean;
  default?: unknown;
  /** 条件显示：仅当指定字段匹配指定值时显示此参数 */
  dependsOn?: { field: string; value: string };
}

interface Props {
  toolName: string;
  onSubmit: (args: Record<string, unknown>) => void;
  loading?: boolean;
  /** 从图库选中的图片路径（外部注入） */
  selectedPath?: string | null;
  /** 取消/关闭回调 */
  onCancel?: () => void;
}

export default function ToolParamForm({
  toolName,
  onSubmit,
  loading,
  selectedPath,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const schema = getToolSchema(toolName);
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    if (schema) {
      for (const p of schema.params) {
        if (p.default !== undefined) initial[p.name] = p.default;
      }
    }
    return initial;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 跟踪是否已经填入过路径（避免重复覆盖用户手动输入的）
  const lastSelectedPath = useRef<string | null | undefined>(null);

  // 外部 selectedPath 变化时自动填入 inputPath
  useEffect(() => {
    if (selectedPath && selectedPath !== lastSelectedPath.current) {
      lastSelectedPath.current = selectedPath;
      setValues((prev) => ({ ...prev, inputPath: selectedPath }));
    }
  }, [selectedPath]);

  const handleChange = useCallback((name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (prev[name]) {
        const next = { ...prev };
        delete next[name];
        return next;
      }
      return prev;
    });
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // P0-2: 参数校验
    const newErrors: Record<string, string> = {};
    if (schema) {
      for (const p of schema.params) {
        const val = values[p.name];
        if (p.required && (val === undefined || val === "" || val === null)) {
          newErrors[p.name] = t("image.validationRequired");
        }
      }
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const cleaned: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(values)) {
      if (val !== "" && val !== undefined && val !== null) cleaned[key] = val;
    }
    onSubmit(cleaned);
  };

  if (!schema) {
    return <div className="text-xs text-gray-500">{t("common.error")}</div>;
  }

  /** 判断参数是否应使用 textarea */
  const isTextarea = (name: string) =>
    /prompt|description|text|watermark/i.test(name);

  /** 判断参数是否应使用 color picker */
  const isColor = (name: string) =>
    /color|background/i.test(name) && !/backgroundColor/.test(name) === false;

  /** 判断数字参数是否应使用 range（有界数值） */
  const isRangeParam = (name: string) =>
    [
      "quality",
      "brightness",
      "contrast",
      "saturation",
      "samplePrecision",
    ].includes(name);

  /** range 参数的边界 */
  const rangeBounds: Record<
    string,
    { min: number; max: number; step: number }
  > = {
    quality: { min: 1, max: 100, step: 1 },
    brightness: { min: -100, max: 100, step: 1 },
    contrast: { min: -100, max: 100, step: 1 },
    saturation: { min: 0, max: 200, step: 1 },
    samplePrecision: { min: 1, max: 10, step: 1 },
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <h3 className="text-sm font-medium text-gray-200">
        {t(schema.titleKey)}
      </h3>

      {schema.params.map((param) => {
        // 条件显示：检查 dependsOn
        if (param.dependsOn) {
          const { field, value } = param.dependsOn;
          const fieldValue = values[field];
          if (fieldValue !== value) return null;
        }

        const value = values[param.name];

        return (
          <div key={param.name} className="space-y-1">
            <label className="text-[10px] text-gray-400 flex items-center gap-1">
              {t(param.descriptionKey)}
              {param.required && <span className="text-red-500">*</span>}
            </label>

            {param.type === "boolean" ? (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={value === true}
                  onChange={(e) => handleChange(param.name, e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-800 accent-blue-500"
                />
                <span className="text-[10px] text-gray-400">
                  {value ? t("common.yes") : t("common.no")}
                </span>
              </label>
            ) : param.type === "array" ? (
              <input
                type="text"
                value={
                  Array.isArray(value)
                    ? (value as string[]).join(", ")
                    : value !== undefined
                      ? String(value)
                      : ""
                }
                onChange={(e) =>
                  handleChange(
                    param.name,
                    e.target.value
                      ? e.target.value.split(",").map((s) => s.trim())
                      : [],
                  )
                }
                placeholder={t(param.descriptionKey)}
                className={`w-full bg-gray-800 border rounded px-2 py-1 text-xs text-gray-200 ${errors[param.name] ? "border-red-500" : "border-gray-600"}`}
              />
            ) : param.enum ? (
              <select
                value={String(value ?? param.default ?? "")}
                onChange={(e) => handleChange(param.name, e.target.value)}
                className={`w-full bg-gray-800 border rounded px-2 py-1 text-xs text-gray-200 ${errors[param.name] ? "border-red-500" : "border-gray-600"}`}
              >
                <option value="">-- {t("image.selectOption")} --</option>
                {param.enum.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : param.type === "number" ? (
              isRangeParam(param.name) && rangeBounds[param.name] ? (
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={rangeBounds[param.name].min}
                    max={rangeBounds[param.name].max}
                    step={rangeBounds[param.name].step}
                    value={
                      value !== undefined
                        ? Number(value)
                        : rangeBounds[param.name].min
                    }
                    onChange={(e) =>
                      handleChange(param.name, Number(e.target.value))
                    }
                    className="flex-1 h-1 accent-blue-500"
                  />
                  <span className="text-[10px] text-gray-300 w-8 text-right shrink-0">
                    {value !== undefined
                      ? String(value)
                      : rangeBounds[param.name].min}
                  </span>
                </div>
              ) : (
                <input
                  type="number"
                  value={value !== undefined ? String(value) : ""}
                  onChange={(e) =>
                    handleChange(
                      param.name,
                      e.target.value ? Number(e.target.value) : undefined,
                    )
                  }
                  placeholder={t(param.descriptionKey)}
                  className={`w-full bg-gray-800 border rounded px-2 py-1 text-xs text-gray-200 ${errors[param.name] ? "border-red-500" : "border-gray-600"}`}
                />
              )
            ) : isColor(param.name) ? (
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={value ? String(value) : "#000000"}
                  onChange={(e) => handleChange(param.name, e.target.value)}
                  className="w-6 h-6 rounded border border-gray-600 bg-transparent cursor-pointer p-0"
                />
                <input
                  type="text"
                  value={value !== undefined ? String(value) : ""}
                  onChange={(e) => handleChange(param.name, e.target.value)}
                  placeholder="#RRGGBB"
                  className={`flex-1 bg-gray-800 border rounded px-2 py-1 text-xs text-gray-200 ${errors[param.name] ? "border-red-500" : "border-gray-600"}`}
                />
              </div>
            ) : isTextarea(param.name) ? (
              <textarea
                value={value !== undefined ? String(value) : ""}
                onChange={(e) => handleChange(param.name, e.target.value)}
                placeholder={t(param.descriptionKey)}
                required={param.required}
                rows={3}
                className={`w-full bg-gray-800 border rounded px-2 py-1 text-xs text-gray-200 resize-y ${errors[param.name] ? "border-red-500" : "border-gray-600"}`}
              />
            ) : (
              <input
                type="text"
                value={value !== undefined ? String(value) : ""}
                onChange={(e) => handleChange(param.name, e.target.value)}
                placeholder={t(param.descriptionKey)}
                required={param.required}
                className={`w-full bg-gray-800 border rounded px-2 py-1 text-xs text-gray-200 ${errors[param.name] ? "border-red-500" : "border-gray-600"}`}
              />
            )}
            {errors[param.name] && (
              <div className="text-[9px] text-red-400">
                {errors[param.name]}
              </div>
            )}
          </div>
        );
      })}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white rounded px-3 py-1.5 text-xs cursor-pointer transition-colors border-0"
        >
          {loading ? t("image.executing") : t("image.run")}
        </button>
        <button
          type="button"
          onClick={() => {
            const initial: Record<string, unknown> = {};
            if (schema) {
              for (const p of schema.params) {
                if (p.default !== undefined) initial[p.name] = p.default;
              }
            }
            setValues(initial);
            setErrors({});
          }}
          disabled={loading}
          className="px-3 py-1.5 rounded text-xs border-0 cursor-pointer bg-gray-700/60 text-gray-300 hover:bg-gray-600/50 disabled:opacity-40"
        >
          {t("common.reset")}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-3 py-1.5 rounded text-xs border-0 cursor-pointer bg-gray-700/40 text-gray-400 hover:bg-gray-600/40 disabled:opacity-40"
          >
            ✕
          </button>
        )}
      </div>
    </form>
  );
}
