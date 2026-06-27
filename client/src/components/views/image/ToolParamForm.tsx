/**
 * ToolParamForm
 * 通用工具参数表单 — 根据工具名动态渲染参数控件（全 i18n）
 */
import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { getToolSchema } from "./toolRegistry";

export interface ToolParam {
  name: string;
  type: "string" | "number";
  enum?: string[];
  descriptionKey: string;
  required: boolean;
  default?: unknown;
}

interface Props {
  toolName: string;
  onSubmit: (args: Record<string, unknown>) => void;
  loading?: boolean;
}

export default function ToolParamForm({ toolName, onSubmit, loading }: Props) {
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

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <h3 className="text-sm font-medium text-gray-200">{t(schema.titleKey)}</h3>

      {schema.params.map((param) => {
        const value = values[param.name];

        return (
          <div key={param.name} className="space-y-1">
            <label className="text-[10px] text-gray-400 flex items-center gap-1">
              {t(param.descriptionKey)}
              {param.required && <span className="text-red-500">*</span>}
            </label>

            {param.enum ? (
              <select
                value={String(value ?? param.default ?? "")}
                onChange={(e) => handleChange(param.name, e.target.value)}
                className={`w-full bg-gray-800 border rounded px-2 py-1 text-xs text-gray-200 ${errors[param.name] ? "border-red-500" : "border-gray-600"}`}
              >
                <option value="">-- {t("image.selectOption")} --</option>
                {param.enum.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : param.type === "number" ? (
              <input
                type="number"
                value={value !== undefined ? String(value) : ""}
                onChange={(e) => handleChange(param.name, e.target.value ? Number(e.target.value) : undefined)}
                placeholder={t(param.descriptionKey)}
                className={`w-full bg-gray-800 border rounded px-2 py-1 text-xs text-gray-200 ${errors[param.name] ? "border-red-500" : "border-gray-600"}`}
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
              <div className="text-[9px] text-red-400">{errors[param.name]}</div>
            )}
          </div>
        );
      })}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white rounded px-3 py-1.5 text-xs cursor-pointer transition-colors border-0"
      >
        {loading ? t("image.executing") : t("image.run")}
      </button>
    </form>
  );
}
