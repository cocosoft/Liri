import { useEffect, useState } from "react";
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
        toastInfo("已解除全局暂停，新工作恢复执行");
      } else {
        toastWarning(res.error?.message ?? "解除全局暂停失败");
      }
      return;
    }

    // 启用暂停：二次确认
    const confirmed = window.confirm(
      "启用全局暂停后，新的消息发送与定时任务触发将被暂停（进行中的工作不受影响）。确定启用？",
    );
    if (!confirmed) return;

    setLoading(true);
    const res = await systemService.engageEstop(reason.trim() || undefined);
    setLoading(false);
    if (res.ok) {
      setEngaged(true);
      setState(res.data?.state ?? null);
      toastInfo("已启用全局暂停");
    } else {
      toastWarning(res.error?.message ?? "启用全局暂停失败");
    }
  }

  const engagedAtText = state?.engagedAt
    ? new Date(state.engagedAt).toLocaleString()
    : "";

  return (
    <ConfigSection
      title="全局暂停（ESTOP）"
      description="紧急停止：暂停新消息发送与新的定时任务触发，进行中的工作不受影响；解除后自动恢复。"
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
          {engaged ? "已暂停" : "运行中"}
        </span>
        {engaged && engagedAtText && (
          <span className="text-xs text-gray-500 dark:text-gray-400">
            启用时间：{engagedAtText}
          </span>
        )}
      </div>

      {/* 暂停原因（启用前填写 / 启用后展示） */}
      <div className="mb-3">
        <label
          className={`block text-xs mb-1 ${isDark ? "text-gray-400" : "text-gray-600"}`}
        >
          暂停原因（可选）
        </label>
        <input
          type="text"
          value={reason}
          disabled={engaged}
          onChange={(e) => setReason(e.target.value)}
          placeholder="例如：正在进行维护"
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
        {loading ? "处理中..." : engaged ? "解除全局暂停" : "启用全局暂停"}
      </button>

      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
        说明：全局暂停不影响正在进行的回复与工具执行；暂停期间发送的新消息会收到提示。解除后可立即恢复。
      </p>
    </ConfigSection>
  );
}
