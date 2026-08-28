/**
 * SchemaFormField — schema 驱动表单通用字段渲染器（D10）
 *
 * 根据 SchemaField 定义自动渲染 text/password/select/checkbox/textarea，
 * 统一深色模式样式。字段增删改只改 schema，UI 自动对齐。
 */
import type { ProviderFormData } from "../../types";
import type { SchemaField } from "./ProviderFormSchema";

interface SchemaFormFieldProps {
  field: SchemaField;
  value: ProviderFormData[keyof ProviderFormData];
  isDark: boolean;
  onChange: (value: string | boolean) => void;
  /** apiKey 等 credentialControl 字段的凭据控制（write-only） */
  credential?: {
    hasKey: boolean;
    clearApiKey: boolean;
    onToggleClear: () => void;
  };
}

const inputClass =
  "w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm";
const labelClass =
  "block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1";

export default function SchemaFormField({
  field,
  value,
  isDark,
  onChange,
  credential,
}: SchemaFormFieldProps) {
  if (field.type === "checkbox") {
    const checked = field.inverted ? !value : !!value;
    return (
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`schema-${field.key}`}
          checked={checked}
          onChange={(e) => onChange(field.inverted ? !e.target.checked : e.target.checked)}
          className="rounded"
        />
        <label
          htmlFor={`schema-${field.key}`}
          className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"} cursor-pointer`}
        >
          {field.label}
        </label>
      </div>
    );
  }

  if (field.type === "select" && field.options) {
    return (
      <div>
        <label className={labelClass}>
          {field.label}
          {field.required && <span className="text-red-500"> *</span>}
        </label>
        <select
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        >
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <div>
        <label className={labelClass}>{field.label}</label>
        <textarea
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={`${inputClass} resize-y min-h-[64px]`}
        />
      </div>
    );
  }

  return (
    <div>
      <label className={labelClass}>
        {field.label}
        {field.required && <span className="text-red-500"> *</span>}
        {field.credentialControl && credential && (
          <span
            className={`ml-1 text-[10px] px-1 py-0.5 rounded ${
              credential.hasKey
                ? "bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400"
                : "bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400"
            }`}
          >
            {credential.hasKey ? "已配置" : "未配置"}
          </span>
        )}
      </label>
      <input
        type={field.type === "password" ? "password" : "text"}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          field.credentialControl && credential?.hasKey
            ? "已配置，留空保存则保留现有 Key"
            : field.placeholder
        }
        className={inputClass}
      />
      {field.credentialControl && credential?.hasKey && (
        <button
          type="button"
          onClick={credential.onToggleClear}
          className={`mt-1 text-[11px] underline ${
            credential.clearApiKey
              ? "text-red-500 dark:text-red-400"
              : "text-gray-400 dark:text-gray-500 hover:text-red-500"
          }`}
        >
          {credential.clearApiKey
            ? "将清除已配置的 API Key（保存后生效）"
            : "清除 API Key"}
        </button>
      )}
    </div>
  );
}
