import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfigSection } from "./ConfigComponents";
import {
  systemService,
  type EstopStateDto,
} from "../../services/systemService";
import { toastWarning, toastInfo } from "../../stores/toastStore";

interface EstopPanelProps {
  isDark: boolean;
  collapsible?: boolean;
}

/**
 * EstopPanel — 全局暂停（ESTOP）开关面板（2026-09-02，P3-4 前端落地）
 *
 * 语义（对齐后端 estop.ts）：启用后暂停新消息发送与新的定时任务触发，
 * 进行中的工作不受影响；解除后立即恢复。sentinel 持久化于 ~/.pyapp/data/ESTOP。
 */
export default function EstopPanel({ isDark, collapsible }: EstopPanelProps) {
  const { t } = useTranslation();
  const [engaged, setEngaged] = useState(false);
  const [state, setState] = useState<EstopStateDto | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(): Promise<void> {
    const res = await systemService.getEstopStatus();
    if (res.ok && res.data) {
      setEngaged(res.data.engaged);
      setState(res.data.state);
      setReason(res.data.state?.reason ?? "");
    }
  }

  async function handleToggle(): Promise<void> {
    if (loading) return;

    if (engaged) {
      // 解除暂停
      setLoading(true);
      const res = await systemService.disengageEstop();
      setLoading(false);
      if (res.ok) {
        setEngaged(false);
        setState(null);
        toastInfo(t("settings.estopDisengaged"));
      } else {
        toastWarning(res.error?.message ?? t("settings.estopDisengageFailed"));
      }
      return;
    }

    // 启用暂停：二次确认
    const confirmed = window.confirm(t("settings.estopConfirm"));
    if (!confirmed) return;

    setLoading(true);
    const res = await systemService.engageEstop(reason.trim() || undefined);
    setLoading(false);
    if (res.ok) {
      setEngaged(true);
      setState(res.data?.state ?? null);
      toastInfo(t("settings.estopEngaged"));
    } else {
      toastWarning(res.error?.message ?? t("settings.estopEngageFailed"));
    }
  }

  const engagedAtText = state?.engagedAt
    ? new Date(state.engagedAt).toLocaleString()
    : "";

  return (
    <ConfigSection
      title={t("settings.estop")}
      description={t("settings.estopDesc")}
      isDark={isDark}
      collapsible={collapsible}
    >
      {/* 状态徽章 */}
      <div className="flex items-center gap-2 mb-3">
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ${
            engaged
              ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
              : "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              engaged ? "bg-red-500" : "bg-green-500"
            }`}
          />
          {engaged ? t("settings.estopPaused") : t("common.running")}
        </span>
        {engaged && engagedAtText && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("settings.estopEngagedAt", { time: engagedAtText })}
          </span>
        )}
      </div>

      {/* 暂停原因（启用前填写 / 启用后展示） */}
      <div className="mb-3">
        <label
          className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}
        >
          {t("settings.estopReason")}
        </label>
        <input
          type="text"
          value={reason}
          disabled={engaged}
          onChange={(e) => setReason(e.target.value)}
          placeholder={t("settings.estopReasonPlaceholder")}
          className={`w-full px-3 py-2 text-sm rounded-lg border transition-colors ${
            engaged
              ? "opacity-60 cursor-not-allowed"
              : "focus:outline-none focus:ring-2 focus:ring-blue-500"
          } ${
            isDark
              ? "bg-gray-800 border-gray-700 text-gray-100"
              : "bg-white border-gray-300 text-gray-900"
          }`}
        />
      </div>

      {/* 开关按钮 */}
      <button
        onClick={handleToggle}
        disabled={loading}
        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
          engaged
            ? "bg-green-600 hover:bg-green-700 text-white"
            : "bg-red-600 hover:bg-red-700 text-white"
        }`}
      >
        {loading
          ? t("settings.processing")
          : engaged
            ? t("settings.estopDisengage")
            : t("settings.estopEngage")}
      </button>

      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        {t("settings.estopNote")}
      </p>
    </ConfigSection>
  );
}
