/**
 * Provider 表单 Schema（D10：schema 驱动表单）
 *
 * 单一字段定义来源 → SchemaFormField 自动渲染。
 * 新增/调整字段只需改这里，表单 UI 自动对齐（无需手写 JSX）。
 */
import type { ProviderFormData } from "../../types";
import { PROVIDER_TYPE_LABELS } from "../../config/providerPresets";

export type SchemaFieldType =
  | "text"
  | "password"
  | "select"
  | "checkbox"
  | "textarea";

export interface SchemaField<
  T extends keyof ProviderFormData = keyof ProviderFormData,
> {
  /** 表单数据字段 key */
  key: T;
  label: string;
  type: SchemaFieldType;
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  /** checkbox 反向语义：勾选 = 该字段为 false（如 requiresAuth） */
  inverted?: boolean;
  /** 密码字段是否展示"已配置/清除"凭据控制（write-only） */
  credentialControl?: boolean;
}

export const PROVIDER_FORM_SCHEMA: SchemaField[] = [
  {
    key: "name",
    label: "名称",
    type: "text",
    required: true,
    placeholder: "例如: DeepSeek",
  },
  {
    key: "providerType",
    label: "类型",
    type: "select",
    options: Object.entries(PROVIDER_TYPE_LABELS).map(([value, label]) => ({
      value,
      label,
    })),
  },
  {
    key: "baseUrl",
    label: "Base URL",
    type: "text",
    required: true,
    placeholder: "https://api.deepseek.com",
  },
  {
    key: "apiKey",
    label: "API Key",
    type: "password",
    credentialControl: true,
    placeholder: "sk-...",
  },
  {
    key: "notes",
    label: "备注",
    type: "text",
    placeholder: "可选备注",
  },
  {
    key: "requiresAuth",
    label: "本地供应商（无需 API Key，如 Ollama / LM Studio）",
    type: "checkbox",
    inverted: true,
  },
];
