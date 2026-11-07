/**
 * 「回答模式」菜单（前端控制面简化 A′，2026-11-05）
 *
 * 把原先并列的 3 个旋钮（模式 / 详略 / 快速模式）收成一个入口：
 *   自动 / 快速 / 深思 / 代码 / 创意 / 研究
 *
 * 写路径**复用既有实现**（不另造状态）：
 *  - 档位：`onChange` 交给 ChatInput 持有，随消息以 `chat_mode` 下发；
 *  - 详略：`effort auto`（`/effort` 同一条命令；非 auto 时归零，思考预算交给模式）；
 *  - 快速：`fast on|off`（`/fast` 同一条命令；全局偏好，只在需要变化时写）。
 *
 * 写入失败必须提示（CS03），不静默假装成功。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReplyEffortLevel } from "@/types";
import { configService } from "@/services/configService";
import { runCommand } from "@/services/commandService";
import { handleClientError } from "@/utils/handleError";
import { toastError, toastInfo } from "@/stores/toastStore";
import ReplyModeIcon from "./replyModeIcons";
import { REPLY_MODES, type ReplyMode } from "./replyModeOptions";

interface ReplyModeMenuProps {
  /** 当前档位（由 ChatInput 持有并随消息下发） */
  value: ReplyMode;
  /** 档位切换回调 */
  onChange: (mode: ReplyMode) => void;
  /** 绑定会话 id（详略是会话级偏好）；缺省时跳过详略写入 */
  sessionId?: string;
  /** 当前会话详略档；`undefined` 按 `auto` 处理 */
  effortLevel?: ReplyEffortLevel;
  /** 详略归零成功回调：调用方就地更新本地会话缓存 */
  onEffortReset?: () => void;
  /** 无会话等场景由调用方统一禁用 */
  disabled?: boolean;
}

export default function ReplyModeMenu({
  value,
  onChange,
  sessionId,
  effortLevel,
  onEffortReset,
  disabled = false,
}: ReplyModeMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  /** `null` = 尚未读到（不猜测；读到 false 才显示为关） */
  const [fastMode, setFastMode] = useState<boolean | null>(null);

  const current =
    REPLY_MODES.find((item) => item.key === value) ?? REPLY_MODES[0];

  // 关闭：点面板外任意处 / 按 Esc（与 ReplyPrefsMenu 同款，透明遮罩会被上层盖住）
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // 快速模式是全局配置：挂载时读一次（单个 GET，不随会话变化）
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = (await configService.get("fastMode")) as
        { value?: unknown } | null | undefined;
      if (!cancelled) setFastMode(res?.value === true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelect = useCallback(
    async (mode: ReplyMode) => {
      setOpen(false);
      if (mode === value || pending) return;
      setPending(true);
      // 档位本身由 ChatInput 持有（随消息下发），先切本地保证即时反馈
      onChange(mode);
      try {
        // 详略归零：档位承载思考预算，避免两个旋钮争同一预算
        if (sessionId && (effortLevel ?? "auto") !== "auto") {
          const res = await runCommand("effort auto", sessionId);
          if (!res.success) {
            toastError(new Error(res.error || t("chat.effortUpdateFailed")));
          } else {
            onEffortReset?.();
            toastInfo(t("chat.effortResetHint"));
          }
        }
        // 快速档 = 全局 fastMode 开；其余档 = 关（仅在实际需要变化时写）
        const wantFast = mode === "quick";
        if (fastMode !== null && fastMode !== wantFast) {
          const res = await runCommand(wantFast ? "fast on" : "fast off");
          if (!res.success) {
            toastError(new Error(res.error || t("chat.fastModeUpdateFailed")));
          } else {
            setFastMode(wantFast);
            // 快速模式是**全局**偏好：切换后会影响所有会话，必须明说
            if (wantFast) toastInfo(t("chat.fastModeGlobalHint"));
          }
        }
      } catch (err) {
        handleClientError(err, {
          module: "components:chat:ReplyModeMenu",
          action: "switchReplyMode",
        });
        toastError(new Error(t("chat.replyModeSwitchFailed")));
      } finally {
        setPending(false);
      }
    },
    [
      value,
      pending,
      onChange,
      sessionId,
      effortLevel,
      onEffortReset,
      fastMode,
      t,
    ],
  );

  return (
    <div className="relative" ref={rootRef}>
      {/* P3（2026-11-07）：hover 即说明作用面（不是权限开关），避免与右侧「权限」混淆 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled || pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("chat.replyModeTitle")}
        title={t("chat.replyModeFooter")}
        className="flex items-center gap-1 rounded-full border border-gray-300 bg-white px-2 py-0.5 text-xs transition-colors hover:border-blue-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:border-blue-500"
      >
        <ReplyModeIcon mode={current.key} className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-[6.5rem] truncate text-gray-500 dark:text-gray-400">
          {t(current.labelKey)}
        </span>
        {/* 研究档走独立链路：选中有徽标，避免误以为仍是普通对话 */}
        {value === "research" && (
          <span className="shrink-0 rounded bg-violet-100 px-1 text-[10px] leading-4 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300">
            {t("chat.replyModeResearchBadge")}
          </span>
        )}
        <svg
          className="h-3 w-3 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={t("chat.replyModeTitle")}
          className="absolute bottom-full left-0 z-20 mb-1 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
        >
          {REPLY_MODES.map((mode) => (
            <button
              key={mode.key}
              type="button"
              role="option"
              aria-selected={value === mode.key}
              onClick={() => void handleSelect(mode.key)}
              className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition-colors ${
                value === mode.key
                  ? "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                  : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              }`}
            >
              <span className="flex items-center gap-2">
                <ReplyModeIcon mode={mode.key} className="h-4 w-4 shrink-0" />
                <span>{t(mode.labelKey)}</span>
              </span>
              {mode.key === "research" && (
                <span className="pl-6 text-[11px] text-gray-400">
                  {t("chat.replyModeResearchHint")}
                </span>
              )}
            </button>
          ))}
          {/* P3（2026-11-07）：说清本旋钮的作用面 —— 它不是权限开关 */}
          <p className="mt-1 border-t border-gray-200 px-3 pt-1.5 text-[11px] leading-relaxed text-gray-400 dark:border-gray-700 dark:text-gray-500">
            {t("chat.replyModeFooter")}
          </p>
        </div>
      )}
    </div>
  );
}
