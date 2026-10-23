/**
 * 会话级「自动执行」开关（PR-3，2026-10-23）
 *
 * 口径（用户已拍板）：**仅只读 + 本地写**。开启后：
 * - 只读工具照旧免审批；
 * - `WRITE_LOCAL` 且**全部路径入参都在会话工作区内**时自动执行（后端审计 `approval:auto`）；
 * - `shell` / 外部副作用 / 工作区外写 / 未声明风险的工具**仍需人工审批**。
 *
 * 事实来源 = 会话 `metadata.approvalMode`（后端唯一）：
 *   单击 → `PATCH /v1/sessions/:id/meta { approval_mode }` → 后端落库 + 广播
 *   `session:meta_updated`（`useInitApp` 订阅后刷新，跨页面/多端回填）。
 *
 * 开启需**二次确认**并说明范围（写操作只放行工作区内）；关闭即时生效、不确认。
 * 后端另有 `FEATURE_SESSION_AUTO_LOCAL` 开关（默认关）—— 开关置开但后端未启用时，
 * 实际仍按 `ask` 处理（前端不谎报：文案写明"需后端启用"）。
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApprovalMode } from "@/types";
import { sessionService } from "@/services/sessionService";
import { handleClientError } from "@/utils/handleError";
import { toastError } from "@/stores/toastStore";

interface ApprovalModeToggleProps {
  /** 绑定会话 id；缺省时禁用 */
  sessionId?: string;
  /** 当前审批模式（缺省 ask） */
  approvalMode?: ApprovalMode;
  /** 切换成功回调：调用方就地更新本地会话缓存 */
  onChanged?: (mode: ApprovalMode) => void;
  /** 流式输出等场景由调用方统一禁用 */
  disabled?: boolean;
}

export default function ApprovalModeToggle({
  sessionId,
  approvalMode,
  onChanged,
  disabled = false,
}: ApprovalModeToggleProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const current: ApprovalMode =
    approvalMode === "auto-local" ? "auto-local" : "ask";
  const isOn = current === "auto-local";

  const apply = useCallback(
    async (next: ApprovalMode) => {
      if (!sessionId || pending) return;
      setPending(true);
      try {
        const ok = await sessionService.updateSessionMeta(sessionId, {
          approvalMode: next,
        });
        if (!ok) {
          // 失败必须让用户知道（不静默假装切换成功，CS03）
          toastError(new Error(t("chat.approvalAutoSwitchFailed")));
          return;
        }
        onChanged?.(next);
      } catch (err) {
        handleClientError(err, {
          module: "components:chat:ApprovalModeToggle",
          action: "switch",
        });
        toastError(new Error(t("chat.approvalAutoSwitchFailed")));
      } finally {
        setPending(false);
        setConfirming(false);
      }
    },
    [sessionId, pending, onChanged, t],
  );

  const handleClick = () => {
    if (!sessionId || disabled || pending) return;
    if (isOn) {
      // 关闭是收紧授权 ⇒ 不加确认
      void apply("ask");
      return;
    }
    setConfirming(true);
  };

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={!sessionId || disabled || pending}
        aria-pressed={isOn}
        title={t("chat.approvalAutoToggleHint")}
        className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          isOn
            ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
            : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        }`}
      >
        {isOn ? t("chat.approvalAutoOn") : t("chat.approvalAutoOff")}
      </button>
      {confirming && !isOn && (
        <span className="flex flex-col gap-1 rounded border border-amber-400/50 bg-amber-50 px-2 py-1 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <span>{t("chat.approvalAutoConfirmBody")}</span>
          <span className="flex gap-2">
            <button
              type="button"
              onClick={() => void apply("auto-local")}
              disabled={pending}
              className="rounded bg-amber-500 px-2 py-0.5 font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {t("chat.approvalAutoConfirm")}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="rounded px-2 py-0.5 text-gray-600 hover:text-gray-800 disabled:opacity-50 dark:text-gray-300"
            >
              {t("common.cancel")}
            </button>
          </span>
        </span>
      )}
    </span>
  );
}
