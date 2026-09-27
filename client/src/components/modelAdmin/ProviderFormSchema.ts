/**
 * Provider 表单 Schema（D10：schema 驱动表单）
 *
 * 单一字段定义来源 → SchemaFormField 自动渲染。
 * 新增/调整字段只需改这里，表单 UI 自动对齐（无需手写 JSX）。
 */
import type { ProviderFormData } from "../../types";
import { PROVIDER_TYPE_LABELS } from "../../config/providerPresets";

export type SchemaFieldType =
  "text" | "password" | "select" | "checkbox" | "textarea";

export interface SchemaField<
  T extends keyof ProviderFormData = keyof ProviderFormData,
> {
  /** 表单数据字段 key */
  key: T;
  /** 可翻译标签键（优先于 label） */
  labelKey?: string;
  /** 语言中立字面标签（无中文时使用） */
  label?: string;
  type: SchemaFieldType;
  required?: boolean;
  /** 可翻译占位符键（优先于 placeholder） */
  placeholderKey?: string;
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
    labelKey: "model.providerFieldName",
    type: "text",
    required: true,
    placeholderKey: "model.providerFieldNamePlaceholder",
  },
  {
    key: "providerType",
    labelKey: "model.providerFieldType",
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
    labelKey: "model.providerFieldNotes",
    type: "text",
    placeholderKey: "model.providerFieldNotesPlaceholder",
  },
  {
    key: "requiresAuth",
    labelKey: "model.providerFieldLocal",
    type: "checkbox",
    inverted: true,
  },
];
