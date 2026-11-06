/**
 * 工作模式开关（Plan/Do）—— 输入区两态开关
 *
 * 用户诉求（2026-09-14）：计划/执行状态要在**输入区**可见且可切换，单击即可，
 * 不需要用户回复文字确认；只要两种状态（plan/do）。
 *
 * N-10（2026-11-06）：缺省从 `plan` 改为 `do` —— 本开关已于 2026-11-05「控制面简化」
 * 从输入区移除（`replyPrefsExposure.test.ts` 锁死不得回挂），缺省 plan 就变成不可逃避的
 * 默认（模型按"只规划、不写文件"行事）。与 `resolveWorkMode()` 的缺省保持一致。
 *
 * 事实来源 = 会话 `metadata.workMode`（后端唯一）：
 *   单击 → `PATCH /v1/sessions/:id/meta { work_mode }` → 后端落库 + 广播
 *   `session:meta_updated`（订阅方 `hooks/useNotificationSSE.ts`，单条重取后合并）
 *   同时**就地**更新本地会话缓存，保证单击后立即反馈（不等往返）。
 *
 * 视觉复用 `WorkModeBadge`（展示层唯一实现），未设置时按全局默认 `do` 显示——
 * 与 `resolveWorkMode()` 的缺省（do）保持同一套语义，避免"开关显示 plan、
 * 实际请求发 do"这类双真相。
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
  /** 当前工作模式；`undefined` 按全局默认 `do` 处理 */
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
  const current: WorkMode = workMode === "plan" ? "plan" : "do";

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
