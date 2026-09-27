/**
 * KnowledgeSettingsPanel — 知识库设置面板（D5）
 *
 * 当前可操作项：扫描件 OCR 运行时开关（持久化到 knowledge.json `ocrEnabled`，
 * 环境变量 KNOWLEDGE_PDF_OCR 优先级更高）。
 * 向量存储类型与 AutoRAG 状态为只读说明（AutoRAG 后端未接线）。
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { knowledgeService } from "../../../services/knowledgeService";
import { toastError } from "../../../stores/toastStore";

export function KnowledgeSettingsPanel({ isDark }: { isDark: boolean }) {
  const { t } = useTranslation();
  const [ocrEnabled, setOcrEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cfg = await knowledgeService.getKnowledgeConfig();
        if (alive) setOcrEnabled(cfg.ocrEnabled === true);
      } catch {
        if (alive) setLoadFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const toggleOcr = async () => {
    if (saving) return;
    setSaving(true);
    const next = !ocrEnabled;
    try {
      const cfg = await knowledgeService.updateKnowledgeConfig({
        ocrEnabled: next,
      });
      setOcrEnabled(cfg.ocrEnabled === true);
    } catch (err) {
      toastError(
        err instanceof Error
          ? err.message
          : t("knowledge.settings.updateFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
        {t("knowledge.settings.semanticTitle")}
      </p>

      {/* OCR 运行时开关（D5） */}
      <div
        className={`rounded-lg border p-3 ${isDark ? "border-gray-700 bg-gray-800/40" : "border-gray-200 bg-white"}`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">
              {t("knowledge.settings.ocrTitle")}
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {t("knowledge.settings.ocrDesc")}
            </p>
          </div>
          <button
            role="switch"
            aria-checked={ocrEnabled}
            disabled={loading || saving}
            onClick={toggleOcr}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${
              ocrEnabled
                ? "bg-blue-600"
                : isDark
                  ? "bg-gray-600"
                  : "bg-gray-300"
            }`}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                ocrEnabled ? "translate-x-[18px]" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5">
          {loadFailed
            ? t("knowledge.settings.loadFailed")
            : saving
              ? t("knowledge.saving")
              : ocrEnabled
                ? t("knowledge.settings.enabledDesc")
                : t("knowledge.settings.disabledDesc")}
        </p>
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500 space-y-2">
        <span className="block">{t("knowledge.settings.vectorStoreNote")}</span>
        <span className="block">{t("knowledge.settings.autoragNote")}</span>
      </p>
    </div>
  );
}
