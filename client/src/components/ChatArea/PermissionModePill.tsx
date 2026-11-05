/**
 * 会话级「权限」胶囊（前端控制面简化 A′ v2，2026-11-05）
 *
 * 对标 Trae 的「完全访问 ▾」与 Claude Code 的权限循环：
 * 输入区只给**一个**控件 + 状态常显；点击文字循环切换，点击 `▾` 展开高级档。
 *
 * 循环：跟随默认 → 只读规划(plan) → 全自动(bypass) → 跟随默认
 * - 「跟随默认」= 清除会话覆盖（`permission_mode: null`）；
 * - `bypass` 会无条件放行 ⇒ 必须**二次确认**（沿用 PermissionModeMenu 的交互与文案）；
 * - 若当前是高级段里的其它档（acceptEdits/auto/ask…），点击先回到「跟随默认」。
 *
 * `▾` 内嵌 `PermissionModeMenu` 的 inline 形态（9 档全量），
 * 因此不再需要工具栏的「⋯ / 更多」入口。
 *
 * 事实来源 = 会话 `metadata.permission_mode`（后端唯一）：
 *   `PATCH /v1/sessions/:id/meta` → 后端落库并广播 `session:meta_updated`。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SessionPermissionMode } from "@/types";
import { sessionService } from "@/services/sessionService";
import { handleClientError } from "@/utils/handleError";
import { toastError } from "@/stores/toastStore";
import PermissionModeMenu from "./PermissionModeMenu";
import PermissionModeIcon from "./permissionModeIcons";

/** 循环顺序（`undefined` = 跟随默认） */
const CYCLE: readonly (SessionPermissionMode | undefined)[] = [
  undefined,
  "plan",
  "bypass",
];

interface PermissionModePillProps {
  /** 绑定会话 id；缺省时禁用 */
  sessionId?: string;
  /** 当前会话覆盖值；缺省 ⇒ 跟随默认 */
  permissionMode?: SessionPermissionMode;
  /** 切换成功回调（`undefined` = 已清除覆盖、跟随默认） */
  onChanged?: (mode: SessionPermissionMode | undefined) => void;
  /** 流式输出等场景由调用方统一禁用 */
  disabled?: boolean;
}

export default function PermissionModePill({
  sessionId,
  permissionMode,
  onChanged,
  disabled = false,
}: PermissionModePillProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [openAdvanced, setOpenAdvanced] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const label =
    permissionMode === undefined
      ? t("chat.permission.pillDefault")
      : permissionMode === "plan"
        ? t("chat.permission.pillPlan")
        : permissionMode === "bypass"
          ? t("chat.permission.pillBypass")
          : t(`chat.permission.mode.${permissionMode}`);

  // 关闭高级面板：点面板外 / 按 Esc（与 ReplyModeMenu 同款）
  useEffect(() => {
    if (!openAdvanced) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(event.target as Node)) setOpenAdvanced(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenAdvanced(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openAdvanced]);

  const apply = useCallback(
    async (next: SessionPermissionMode | null) => {
      if (!sessionId || pending) return;
      setPending(true);
      try {
        const ok = await sessionService.updateSessionMeta(sessionId, {
          permissionMode: next,
        });
        if (!ok) {
          // 失败必须让用户知道（不静默假装切换成功，CS03）
          toastError(new Error(t("chat.permission.switchFailed")));
          return;
        }
        onChanged?.(next ?? undefined);
        setOpenAdvanced(false);
      } catch (err) {
        handleClientError(err, {
          module: "components:chat:PermissionModePill",
          action: "switch",
        });
        toastError(new Error(t("chat.permission.switchFailed")));
      } finally {
        setPending(false);
        setConfirming(false);
      }
    },
    [sessionId, pending, onChanged, t],
  );

  const handleClick = () => {
    if (!sessionId || disabled || pending) return;
    const index = CYCLE.indexOf(permissionMode);
    // 高级档（不在循环里）⇒ 点击先回到「跟随默认」
    const next = index === -1 ? undefined : CYCLE[(index + 1) % CYCLE.length];
    if (next === "bypass") {
      setConfirming(true);
      return;
    }
    void apply(next ?? null);
  };

  const isBypass = permissionMode === "bypass";

  return (
    <div className="relative" ref={rootRef}>
      <div
        className={`flex items-center rounded-full border text-xs transition-colors ${
          isBypass
            ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300"
            : "border-gray-300 bg-white hover:border-amber-300 dark:border-gray-600 dark:bg-gray-800 dark:hover:border-amber-500"
        }`}
      >
        <button
          type="button"
          onClick={handleClick}
          disabled={!sessionId || disabled || pending}
          aria-label={t("chat.permission.pillAria", { label })}
          title={t("chat.permission.pillHint")}
          className="flex min-w-0 items-center gap-1 rounded-l-full py-0.5 pl-2 pr-1 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PermissionModeIcon
            mode={permissionMode ?? "default"}
            className="h-3.5 w-3.5 shrink-0"
          />
          <span
            className={`max-w-[6.5rem] truncate ${
              isBypass ? "" : "text-gray-500 dark:text-gray-400"
            }`}
          >
            {label}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setOpenAdvanced((v) => !v)}
          disabled={!sessionId || disabled || pending}
          aria-haspopup="listbox"
          aria-expanded={openAdvanced}
          aria-label={t("chat.moreAdvanced")}
          title={t("chat.moreAdvanced")}
          className="rounded-r-full py-0.5 pl-0.5 pr-1.5 text-gray-400 transition-colors hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:text-gray-200"
        >
          <svg
            className="h-3 w-3"
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
      </div>
      {openAdvanced && (
        <div
          role="dialog"
          aria-label={t("chat.moreAdvanced")}
          className="absolute bottom-full left-0 z-20 mb-1 w-64 rounded-lg border border-gray-200 bg-white pb-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
        >
          <div className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200">
            {t("chat.moreAdvanced")}
          </div>
          <PermissionModeMenu
            inline
            sessionId={sessionId}
            permissionMode={permissionMode}
            onChanged={(mode) => {
              onChanged?.(mode);
              setOpenAdvanced(false);
            }}
            disabled={disabled}
          />
        </div>
      )}
      {confirming && (
        <div className="absolute bottom-full left-0 z-30 mb-1 w-72 rounded border border-amber-400/50 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 shadow-lg dark:bg-amber-950/40 dark:text-amber-300">
          <div className="mb-1">{t("chat.permission.bypassConfirmBody")}</div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void apply("bypass")}
              disabled={pending}
              className="rounded bg-amber-500 px-2 py-0.5 font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {t("chat.permission.bypassConfirm")}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="rounded px-2 py-0.5 text-gray-600 hover:text-gray-800 disabled:opacity-50 dark:text-gray-300"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
