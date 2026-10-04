/**
 * 工作模式开关（Plan/Do）—— 输入区两态开关
 *
 * 用户诉求（2026-09-14）：计划/执行状态要在**输入区**可见且可切换，单击即可，
 * 不需要用户回复文字确认；只要两种状态（plan/do），聊天默认 plan。
 *
 * 事实来源 = 会话 `metadata.workMode`（后端唯一）：
 *   单击 → `PATCH /v1/sessions/:id/meta { work_mode }` → 后端落库 + 广播
 *   `session:meta_updated`（`useInitApp` 订阅后刷新列表，实现跨页面/多端回填）
 *   同时**就地**更新本地会话缓存，保证单击后立即反馈（不等往返）。
 *
 * 视觉复用 `WorkModeBadge`（展示层唯一实现），未设置时按全局默认 `plan` 显示——
 * 与 `resolveWorkMode()` 的缺省（plan）保持同一套语义，避免"开关显示 do、
 * 实际请求发 plan"这类双真相。
 */

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkMode } from "@/types";
import { sessionService } from "@/services/sessionService";
import { handleClientError } from "@/utils/handleError";
import { toastError } from "@/stores/toastStore";
import WorkModeBadge from "./WorkModeBadge";

interface WorkModeToggleProps {
  /** 绑定会话 id（工作模式是会话级 metadata）；缺省时开关禁用 */
  sessionId?: string;
  /** 当前工作模式；`undefined` 按全局默认 `plan` 处理 */
  workMode?: WorkMode;
  /** 切换成功回调：调用方就地更新本地会话缓存 */
  onChanged?: (mode: WorkMode) => void;
  /** 流式输出中等场景由调用方统一禁用 */
  disabled?: boolean;
}

export default function WorkModeToggle({
  sessionId,
  workMode,
  onChanged,
  disabled = false,
}: WorkModeToggleProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const current: WorkMode = workMode === "do" ? "do" : "plan";

  const handleToggle = useCallback(async () => {
    if (!sessionId || pending) return;
    const next: WorkMode = current === "plan" ? "do" : "plan";
    setPending(true);
    try {
      const ok = await sessionService.updateSessionMeta(sessionId, {
        workMode: next,
      });
      if (!ok) {
        // 失败必须让用户知道（不静默假装切换成功，CS03）
        toastError(new Error(t("workspace.planDoSwitchFailed")));
        return;
      }
      onChanged?.(next);
    } catch (err) {
      handleClientError(err, {
        module: "components:chat:WorkModeToggle",
        action: "toggle",
      });
      toastError(new Error(t("workspace.planDoSwitchFailed")));
    } finally {
      setPending(false);
    }
  }, [sessionId, pending, current, onChanged, t]);

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={!sessionId || disabled || pending}
      aria-label={t("workspace.planDoToggle")}
      aria-pressed={current === "do"}
      title={t("workspace.planDoToggle")}
      className="rounded transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <WorkModeBadge workMode={current} className="cursor-pointer" />
    </button>
  );
}
