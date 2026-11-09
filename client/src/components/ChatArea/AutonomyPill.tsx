/**
 * 会话级「自主度」胶囊（B2，2026-11-09）
 *
 * demand（许愿式）= 用户只给目标，Liri 自动规划/执行/验收/交付；`interactive`（缺省）= 既有逐轮协作。
 * 与权限档**正交**（不嵌套）：本控件只切"谁来做决定"，越界写/删除/外发命令仍走各自安全闸门。
 *
 * 事实来源 = 会话 `metadata.autonomy`（后端唯一）：
 *   `PATCH /v1/sessions/:id/meta` → 后端落库并广播 `session:meta_updated`。
 * 缺省（`undefined`）按 `interactive` 展示，点击后显式写入 `demand` / `interactive`。
 */

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AutonomyMode } from "@/types";
import { sessionService } from "@/services/sessionService";
import { handleClientError } from "@/utils/handleError";
import { toastError } from "@/stores/toastStore";

interface AutonomyPillProps {
  /** 绑定会话 id；缺省时禁用（新会话首个回合由 B2 服务端入口按会话 metadata 生效） */
  sessionId?: string;
  /** 当前会话自主度；缺省 ⇒ interactive */
  autonomy?: AutonomyMode;
  /** 切换成功回调（后端已落库，调用方只更新本地缓存） */
  onChanged?: (mode: AutonomyMode) => void;
  /** 流式输出等场景由调用方统一禁用 */
  disabled?: boolean;
}

export default function AutonomyPill({
  sessionId,
  autonomy,
  onChanged,
  disabled = false,
}: AutonomyPillProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const isDemand = autonomy === "demand";
  const label = isDemand
    ? t("chat.autonomy.pillDemand")
    : t("chat.autonomy.pillInteractive");

  const apply = useCallback(
    async (next: AutonomyMode) => {
      if (!sessionId || pending) return;
      setPending(true);
      try {
        const ok = await sessionService.updateSessionMeta(sessionId, {
          autonomy: next,
        });
        if (!ok) {
          toastError(new Error(t("chat.autonomy.switchFailed")));
          return;
        }
        onChanged?.(next);
      } catch (error) {
        handleClientError(error, {
          module: "components:chat:AutonomyPill",
          action: "switchAutonomy",
        });
        toastError(new Error(t("chat.autonomy.switchFailed")));
      } finally {
        setPending(false);
      }
    },
    [sessionId, pending, onChanged, t],
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void apply(isDemand ? "interactive" : "demand")}
        disabled={!sessionId || disabled || pending}
        aria-pressed={isDemand}
        aria-label={t("chat.autonomy.pillAria", { label })}
        title={t("chat.autonomy.pillHint")}
        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          isDemand
            ? "border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-500 dark:bg-violet-900/30 dark:text-violet-300"
            : "border-gray-300 bg-white text-gray-500 hover:border-violet-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400 dark:hover:border-violet-500"
        }`}
      >
        <svg
          className="h-3.5 w-3.5 shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
          />
        </svg>
        <span className="max-w-[5.5rem] truncate">{label}</span>
      </button>
    </div>
  );
}
