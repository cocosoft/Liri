/**
 * 会话级「权限模式」选择器（P1 第三层，2026-11-04）
 *
 * 三层优先级的**最内层**：进程默认档（`PERMISSION_MODE` 环境变量）
 * → 会话 `metadata.permission_mode`（本组件写入）→ 单次工具判定的临时覆盖。
 *
 * 事实来源 = 会话 `metadata.permission_mode`（后端唯一）：
 *   选择 → `PATCH /v1/sessions/:id/meta { permission_mode }` → 后端落库并广播
 *   `session:meta_updated`（订阅方：`hooks/useNotificationSSE.ts`，单条重取后合并）。
 *   本组件同时用 `onChanged` **就地**更新本地缓存，避免等到回填才刷新。
 *
 * 口径（与后端一致，**不夸大**）：
 * - 本选择只决定「未命中 deny/用户显式规则的调用**默认怎么处理**」，
 *   **不能**越过 deny 规则、路径边界与沙箱限制（方案 §3.4 红线）；
 * - 「跟随默认」= 清除会话覆盖（`permission_mode: null`），判定回退进程默认档；
 * - `bypass` 会无条件放行（仅 killswitch 之外无拦截）⇒ 需**二次确认**。
 *
 * 2026-11-05（前端控制面简化 A′）：输入区只留 3 档循环胶囊（`PermissionModePill`），
 * 本组件的 9 档全量改以 `inline` 形态嵌进「更多 → 高级权限」，供排障与高级用户使用。
 */
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SessionPermissionMode } from "@/types";
import { sessionService } from "@/services/sessionService";
import { handleClientError } from "@/utils/handleError";
import { toastError } from "@/stores/toastStore";
import { PERMISSION_MODE_KEYS } from "./permissionModeOptions";
import PermissionModeIcon from "./permissionModeIcons";

interface PermissionModeMenuProps {
  /** 绑定会话 id；缺省时禁用 */
  sessionId?: string;
  /** 当前会话覆盖值；缺省 ⇒ 跟随默认 */
  permissionMode?: SessionPermissionMode;
  /** 切换成功回调（`undefined` = 已清除覆盖、跟随默认） */
  onChanged?: (mode: SessionPermissionMode | undefined) => void;
  /** 流式输出等场景由调用方统一禁用 */
  disabled?: boolean;
  /** 内联形态：不渲染触发按钮，直接把档位列表铺开（供「更多」弹层复用） */
  inline?: boolean;
  /**
   * 2026-11-11：调用方要求的**附加 metadata**，与本次 `permission_mode` 合并成
   * **同一次** PATCH（如：许愿式下选"逐次询问档"必须同时把 autonomy 收回 interactive，
   * 否则后端 `AUTONOMY_PERMISSION_CONFLICT` 会 400）。
   */
  extraMeta?: (mode: SessionPermissionMode | null) => {
    autonomy?: "interactive" | "demand";
  };
}

export default function PermissionModeMenu({
  sessionId,
  permissionMode,
  onChanged,
  disabled = false,
  inline = false,
  extraMeta,
}: PermissionModeMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  /** 需要二次确认的档位（仅 bypass：无条件放行） */
  const [confirming, setConfirming] = useState<SessionPermissionMode | null>(
    null,
  );

  const label = permissionMode
    ? t(`chat.permission.mode.${permissionMode}`)
    : t("chat.permission.followDefault");

  const apply = useCallback(
    async (next: SessionPermissionMode | null) => {
      if (!sessionId || pending) return;
      setPending(true);
      try {
        const ok = await sessionService.updateSessionMeta(sessionId, {
          permissionMode: next,
          ...(extraMeta?.(next) ?? {}),
        });
        if (!ok) {
          // 失败必须让用户知道（不静默假装切换成功，CS03）
          toastError(new Error(t("chat.permission.switchFailed")));
          return;
        }
        onChanged?.(next ?? undefined);
        setOpen(false);
      } catch (err) {
        handleClientError(err, {
          module: "components:chat:PermissionModeMenu",
          action: "switch",
        });
        toastError(new Error(t("chat.permission.switchFailed")));
      } finally {
        setPending(false);
        setConfirming(null);
      }
    },
    [sessionId, pending, onChanged, extraMeta, t],
  );

  const handleSelect = (mode: SessionPermissionMode | null) => {
    if (!sessionId || disabled || pending) return;
    // bypass 是唯一"无条件放行"档 ⇒ 二次确认（其余档最多影响默认档，收紧/放宽都可逆）
    if (mode === "bypass") {
      setConfirming("bypass");
      return;
    }
    void apply(mode);
  };

  /** 档位列表（普通形态与 inline 形态共用同一份，禁止两处各写一套） */
  const options = (
    <>
      <button
        type="button"
        role="option"
        aria-selected={permissionMode === undefined}
        onClick={() => void apply(null)}
        className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition-colors ${
          permissionMode === undefined
            ? "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
            : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
        }`}
      >
        <span>{t("chat.permission.followDefault")}</span>
        <span className="text-[11px] text-gray-400">
          {t("chat.permission.followDefaultHint")}
        </span>
      </button>
      {PERMISSION_MODE_KEYS.map((mode) => (
        <button
          key={mode}
          type="button"
          role="option"
          aria-selected={permissionMode === mode}
          onClick={() => handleSelect(mode)}
          className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition-colors ${
            permissionMode === mode
              ? "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
              : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          }`}
        >
          <span className="flex items-center gap-1.5">
            <PermissionModeIcon mode={mode} className="h-3.5 w-3.5 shrink-0" />
            <span>{t(`chat.permission.mode.${mode}`)}</span>
          </span>
          <span className="text-[11px] text-gray-400">
            {t(`chat.permission.modeDesc.${mode}`)}
          </span>
        </button>
      ))}
    </>
  );

  /** inline 形态的单行档位：说明收进 title，行高减半（弹层默认只占约 1/4 屏） */
  const compactRow = (mode: SessionPermissionMode | undefined) => {
    const active = permissionMode === mode;
    const shortLabel =
      mode === undefined
        ? t("chat.permission.pillDefault")
        : mode === "plan"
          ? t("chat.permission.pillPlan")
          : mode === "bypass"
            ? t("chat.permission.pillBypass")
            : t(`chat.permission.mode.${mode}`);
    const desc =
      mode === undefined
        ? t("chat.permission.followDefaultHint")
        : t(`chat.permission.modeDesc.${mode}`);
    return (
      <button
        key={mode ?? "followDefault"}
        type="button"
        role="option"
        aria-selected={active}
        title={desc}
        onClick={() => (mode ? handleSelect(mode) : void apply(null))}
        className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm transition-colors ${
          active
            ? "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
            : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
        }`}
      >
        <span className="flex w-4 shrink-0 justify-center">
          <PermissionModeIcon
            mode={mode ?? "default"}
            className="h-3.5 w-3.5"
          />
        </span>
        <span>{shortLabel}</span>
      </button>
    );
  };

  const confirmPanel = (
    <div
      className={
        inline
          ? "mx-2 my-1 rounded border border-amber-400/50 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
          : "absolute bottom-full right-0 z-30 mb-1 w-72 rounded border border-amber-400/50 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 shadow-lg dark:bg-amber-950/40 dark:text-amber-300"
      }
    >
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
          onClick={() => setConfirming(null)}
          disabled={pending}
          className="rounded px-2 py-0.5 text-gray-600 hover:text-gray-800 disabled:opacity-50 dark:text-gray-300"
        >
          {t("common.cancel")}
        </button>
      </div>
    </div>
  );

  if (inline) {
    // 2026-11-11：只列 5 档（同义档已在后端合并，旧值由后端读取时归一）
    return (
      <div className="relative">
        <div
          role="listbox"
          aria-label={t("chat.permission.hint")}
          className="max-h-[60vh] overflow-y-auto py-1"
        >
          {PERMISSION_MODE_KEYS.map((mode) => compactRow(mode))}
        </div>
        {confirming === "bypass" && confirmPanel}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!sessionId || disabled || pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t("chat.permission.hint")}
        className="flex items-center gap-1 rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs transition-colors hover:border-amber-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:hover:border-amber-500"
      >
        <PermissionModeIcon
          mode={permissionMode ?? "default"}
          className="h-3.5 w-3.5 shrink-0"
        />
        <span className="text-gray-500 dark:text-gray-400">{label}</span>
        <svg
          className="h-3 w-3 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
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
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            role="listbox"
            className="absolute bottom-full left-0 z-20 mb-1 max-h-80 w-64 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
          >
            {options}
          </div>
        </>
      )}
      {confirming === "bypass" && confirmPanel}
    </div>
  );
}
