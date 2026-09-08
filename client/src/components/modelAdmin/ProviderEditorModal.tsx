/**
 * Provider 编辑/新增弹窗组件
 * 从 ModelPage 提取的独立组件
 */

import { useCallback, useState } from "react";
import type { ProviderFormData, ProviderInfo } from "../../types";
import { PROVIDER_FORM_SCHEMA } from "./ProviderFormSchema";
import SchemaFormField from "./SchemaFormField";
import { providerService } from "../../services/providerService";

interface ProviderEditorModalProps {
  /** 编辑模式传入 Provider，新增模式传 null */
  provider?: ProviderInfo | null;
  /** 初始表单数据（从预设填充） */
  initialFormData?: Partial<ProviderFormData>;
  isSaving: boolean;
  isDark: boolean;
  onSave: (data: ProviderFormData) => void;
  onClose: () => void;
}

export default function ProviderEditorModal({
  provider,
  initialFormData,
  isSaving,
  isDark,
  onSave,
  onClose,
}: ProviderEditorModalProps) {
  const [formData, setFormData] = useState<ProviderFormData>(() => ({
    name: provider?.name ?? initialFormData?.name ?? "",
    providerType:
      provider?.providerType ?? initialFormData?.providerType ?? "custom",
    baseUrl: provider?.baseUrl ?? initialFormData?.baseUrl ?? "",
    // P0 凭据迁移：不回填旧 key（write-only），编辑时留空=保留现有
    apiKey: initialFormData?.apiKey ?? "",
    modelsUrl: provider?.modelsUrl ?? initialFormData?.modelsUrl ?? "",
    notes: provider?.notes ?? initialFormData?.notes ?? "",
    requiresAuth:
      provider?.requiresAuth ?? initialFormData?.requiresAuth ?? true,
    icon: provider?.icon ?? initialFormData?.icon,
    iconColor: provider?.iconColor ?? initialFormData?.iconColor,
    category: provider?.category ?? initialFormData?.category,
    // 私有化部署凭据（write-only，编辑不回填；留空=保留现有）
    appId: initialFormData?.appId ?? "",
    agentId: initialFormData?.agentId ?? "",
  }));
  /** P0 凭据迁移：编辑模式显式清除已配置凭据 */
  const [clearApiKey, setClearApiKey] = useState(false);
  /** 测试连接（dawate 编辑态，用已保存凭据走 generateAppKey） */
  const [testing, setTesting] = useState(false);
  const [testState, setTestState] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const handleFieldChange = useCallback(
    (field: keyof ProviderFormData, value: string | boolean) => {
      if (field === "apiKey") {
        // 用户重新输入 key 时取消"清除"意图
        setClearApiKey(false);
      }
      setFormData((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleSave = useCallback(() => {
    if (!formData.name.trim()) return;
    onSave({
      ...formData,
      apiKey: clearApiKey ? null : formData.apiKey,
    });
  }, [formData, onSave, clearApiKey]);

  /** 内网补强：dawate 编辑态「测试连接」（generateAppKey 即通） */
  const runTest = useCallback(async () => {
    if (!provider?.id) return;
    setTesting(true);
    setTestState(null);
    try {
      const res = await providerService.test(provider.id);
      const first = res.results?.[0];
      const statusOk =
        first?.status === undefined ||
        (first.status >= 200 && first.status < 300);
      const ok = !first?.error && statusOk;
      setTestState({
        ok,
        message: ok
          ? `连接正常：appKey 获取成功${first?.latency ? `（${first.latency}ms）` : ""}`
          : first?.error ||
            (first?.status !== undefined && !statusOk
              ? `HTTP ${first.status}`
              : "连接失败"),
      });
    } catch (e) {
      setTestState({
        ok: false,
        message: e instanceof Error ? e.message : "连接失败",
      });
    } finally {
      setTesting(false);
    }
  }, [provider?.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          {provider ? "编辑 Provider" : "新增 Provider"}
        </h3>

        <div className="space-y-3">
          {/* D10：schema 驱动渲染，字段定义见 PROVIDER_FORM_SCHEMA */}
          {PROVIDER_FORM_SCHEMA.filter(
            (field) =>
              !field.whenProviderType ||
              field.whenProviderType === formData.providerType,
          ).map((field) => (
            <SchemaFormField
              key={field.key}
              field={field}
              value={formData[field.key]}
              isDark={isDark}
              onChange={(v) => handleFieldChange(field.key, v)}
              credential={
                field.credentialControl
                  ? {
                      hasKey: !!provider?.hasKey,
                      clearApiKey,
                      onToggleClear: () => {
                        setClearApiKey(true);
                        setFormData((prev) => ({ ...prev, apiKey: "" }));
                      },
                    }
                  : undefined
              }
            />
          ))}
        </div>

        {/* 内网补强：dawate 编辑态「测试连接」（create 态无已存凭据可测，暂不显示） */}
        {formData.providerType === "dawate" && provider?.id && (
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={runTest}
              disabled={testing}
              className="px-4 py-1.5 text-sm border border-emerald-600 text-emerald-600 dark:text-emerald-400 dark:border-emerald-500 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 disabled:opacity-50 transition-colors"
            >
              {testing ? "测试中…" : "测试连接"}
            </button>
            {testState && (
              <span
                className={`text-xs ${
                  testState.ok
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-500 dark:text-red-400"
                }`}
              >
                {testState.message}
              </span>
            )}
          </div>
        )}

        <div className="flex gap-2 mt-5">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm disabled:opacity-50"
          >
            {isSaving ? "保存中..." : "保存"}
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-lg text-sm"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
