/**
 * 会话级「协作方式」胶囊（2026-11-10，控制面收敛 A′ v3）
 *
 * 背景：输入区此前并列两个正交旋钮（权限 3 档循环 + 自主度 2 档），用户无法预判
 * 组合结果（例：许愿式 × 只读规划 = 承诺"只给目标"却每步弹审批）。现已收敛为**一个**
 * 控件、三档语义完整的协作方式；选中时**同一请求**写两个后端字段：
 *
 * | 档位 | autonomy | permission_mode | 用户理解 |
 * |------|----------|-----------------|----------|
 * | 每步确认 | interactive | plan | 每个工具先问我 |
 * | 自动执行 | interactive | default | 按规则与风险放行，越界才问 |
 * | 许愿式 | demand | auto | 只给目标，做到交付（中途最多问一次） |
 *
 * 事实来源仍是会话 metadata（`autonomy` / `permission_mode`），本组件不缓存真值：
 * `PATCH /v1/sessions/:id/meta` → 后端落库并广播 `session:meta_updated`。
 *
 * 「高级」二级入口保留 9 档权限矩阵（`PermissionModeMenu` inline）—— 供排障与无人值守，
 * 默认不展开；从那里选择只改 permission_mode，不动 autonomy。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AutonomyMode, SessionPermissionMode } from "@/types";
import { sessionService } from "@/services/sessionService";
import { handleClientError } from "@/utils/handleError";
import { toastError } from "@/stores/toastStore";
import PermissionModeMenu from "./PermissionModeMenu";
import PermissionModeIcon from "./permissionModeIcons";

/** 三个协作档（不含 advanced：那是"已落在 9 档里、但不对应任一协作档"的展示态） */
type CollaborationMode = "step" | "auto" | "demand";

/** 档位 ⇒ 一次写入的两个 metadata 字段（唯一映射表，禁止在别处再写一套） */
const PRESETS: Record<
  CollaborationMode,
  { autonomy: AutonomyMode; permissionMode: SessionPermissionMode }
> = {
  step: { autonomy: "interactive", permissionMode: "plan" },
  auto: { autonomy: "interactive", permissionMode: "default" },
  demand: { autonomy: "demand", permissionMode: "auto" },
};

const ORDER: readonly CollaborationMode[] = ["step", "auto", "demand"];

/**
 * 与「许愿式」互斥的权限档（后端 `DEMAND_PROMPT_HEAVY_PERMISSION_MODES` 同集合）：
 * 「每步确认」（`plan`，2026-11-11 收缩前的 ask / alwaysAsk 已并入此档）要求逐次审批，
 * 而许愿式承诺"中途最多问一次"。高级区选中它 ⇒ 同时把 autonomy 收回 interactive
 * （否则后端 400），语义等价于选「每步确认」。
 */
const DEMAND_INCOMPATIBLE_MODES: readonly SessionPermissionMode[] = ["plan"];

/** 本次高级选择是否必须把 autonomy 收回 interactive */
function shouldLeaveDemand(
  autonomy: AutonomyMode | undefined,
  next: SessionPermissionMode | null,
): boolean {
  return (
    autonomy === "demand" &&
    next !== null &&
    DEMAND_INCOMPATIBLE_MODES.includes(next)
  );
}

/**
 * 由会话状态反推展示档。
 *
 * - `demand` 优先：许愿式是"委托"语义，压过权限细节；
 * - `plan`（2026-11-11 收缩前含 ask / alwaysAsk）⇒ 统一显示「每步确认」；
 * - `bypass` / `dontAsk` 不属于任一协作档 ⇒ 原样显示权限名（不冒充）；
 * - 缺省 / `default` / `auto` ⇒ 「自动执行」。
 */
function resolveMode(
  autonomy: AutonomyMode | undefined,
  permissionMode: SessionPermissionMode | undefined,
): CollaborationMode | "advanced" {
  if (autonomy === "demand") return "demand";
  switch (permissionMode) {
    case "plan":
      return "step";
    case "bypass":
    case "dontAsk":
      return "advanced";
    default:
      return "auto";
  }
}

interface CollaborationPillProps {
  /** 绑定会话 id；缺省时禁用 */
  sessionId?: string;
  /** 当前会话自主度；缺省 ⇒ interactive */
  autonomy?: AutonomyMode;
  /** 当前会话权限覆盖；缺省 ⇒ 跟随进程默认档 */
  permissionMode?: SessionPermissionMode;
  /** 切换成功回调（仅供调用方就地更新本地缓存；真值以后端广播为准） */
  onChanged?: (next: {
    autonomy: AutonomyMode;
    permissionMode: SessionPermissionMode | undefined;
  }) => void;
  /** 流式输出等场景由调用方统一禁用 */
  disabled?: boolean;
}

export default function CollaborationPill({
  sessionId,
  autonomy,
  permissionMode,
  onChanged,
  disabled = false,
}: CollaborationPillProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const advancedRef = useRef<HTMLDivElement>(null);

  // 展开高级区时把它滚进可视区：菜单在输入框上方弹出、高度受限，
  // 5 档新增后默认位置在折叠行下方（不滚一下会以为点了没反应）
  useEffect(() => {
    if (showAdvanced) advancedRef.current?.scrollIntoView({ block: "nearest" });
  }, [showAdvanced]);

  const mode = resolveMode(autonomy, permissionMode);
  // 高级档（不属于任一协作档的两个值）如实显示权限名，不冒充三档之一
  const label =
    mode === "advanced"
      ? t(
          permissionMode === "bypass"
            ? "chat.permission.pillBypass"
            : "chat.permission.mode.dontAsk",
        )
      : t(`chat.collaboration.${mode}`);
  /** 胶囊图标：沿用权限图标（口径与 label 同源，不另造一套） */
  const iconMode: SessionPermissionMode =
    mode === "advanced"
      ? (permissionMode ?? "default")
      : mode === "step"
        ? "plan"
        : mode === "demand"
          ? "auto"
          : "default";

  // 关闭面板：点面板外 / 按 Esc（与 ReplyModeMenu 同款）
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(event.target as Node)) {
        setOpen(false);
        setShowAdvanced(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setShowAdvanced(false);
      }
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

  const applyPreset = useCallback(
    async (next: CollaborationMode) => {
      if (!sessionId || pending) return;
      setPending(true);
      try {
        const preset = PRESETS[next];
        const ok = await sessionService.updateSessionMeta(sessionId, preset);
        if (!ok) {
          // 失败必须让用户知道（不静默假装切换成功，CS03）
          toastError(new Error(t("chat.collaboration.switchFailed")));
          return;
        }
        onChanged?.(preset);
        setOpen(false);
        setShowAdvanced(false);
      } catch (err) {
        handleClientError(err, {
          module: "components:chat:CollaborationPill",
          action: "switch",
        });
        toastError(new Error(t("chat.collaboration.switchFailed")));
      } finally {
        setPending(false);
      }
    },
    [sessionId, pending, onChanged, t],
  );

  /** 高级区（9 档）选择：只改权限，不动 autonomy；但"逐次询问档"必须让许愿式退出 */
  const handleAdvancedChanged = useCallback(
    (next: SessionPermissionMode | undefined) => {
      onChanged?.({
        autonomy: shouldLeaveDemand(autonomy, next ?? null)
          ? "interactive"
          : (autonomy ?? "interactive"),
        permissionMode: next,
      });
      setOpen(false);
      setShowAdvanced(false);
    },
    [autonomy, onChanged],
  );

  const tone =
    mode === "demand"
      ? "border-violet-400 bg-violet-50 text-violet-700 dark:border-violet-500 dark:bg-violet-900/30 dark:text-violet-300"
      : mode === "advanced"
        ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300"
        : mode === "step"
          ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
          : "border-gray-300 bg-white text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400";

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!sessionId || disabled || pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("chat.collaboration.pillAria", { label })}
        title={t("chat.collaboration.pillHint")}
        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}
      >
        <PermissionModeIcon mode={iconMode} className="h-3.5 w-3.5 shrink-0" />
        <span className="max-w-[6.5rem] truncate">{label}</span>
        <svg
          className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
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
          role="dialog"
          aria-label={t("chat.collaboration.pillAria", { label })}
          // 高度上限取 50vh：弹层向上展开，输入框上方可用高度通常更小；
          // 超出即内部滚动（实测 70vh 会被页面容器的 overflow-hidden 裁掉标题）
          className="absolute bottom-full left-0 z-20 mb-1 max-h-[50vh] w-72 overflow-y-auto rounded-lg border border-gray-200 bg-white pb-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
        >
          <div className="px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200">
            {t("chat.collaboration.menuTitle")}
          </div>
          <div role="listbox" aria-label={t("chat.collaboration.menuTitle")}>
            {ORDER.map((key) => {
              const active = mode === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="option"
                  aria-selected={active}
                  disabled={pending}
                  onClick={() => void applyPreset(key)}
                  className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition-colors disabled:opacity-50 ${
                    active
                      ? "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                      : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                  }`}
                >
                  <span>{t(`chat.collaboration.${key}`)}</span>
                  <span className="text-[11px] text-gray-400">
                    {t(`chat.collaboration.${key}Desc`)}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mx-3 my-1 border-t border-gray-200 dark:border-gray-700" />
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            title={t("chat.collaboration.advancedHint")}
            className="flex w-full items-center justify-between px-3 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            <span>{t("chat.collaboration.advanced")}</span>
            <svg
              className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
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
          {showAdvanced && (
            <div ref={advancedRef}>
              <PermissionModeMenu
                inline
                sessionId={sessionId}
                permissionMode={permissionMode}
                // 与 handleAdvancedChanged 同判定：同一次 PATCH 里把 autonomy 一起收回，
                // 否则后端会以 AUTONOMY_PERMISSION_CONFLICT 拒绝（400）
                extraMeta={(next) =>
                  shouldLeaveDemand(autonomy, next)
                    ? { autonomy: "interactive" }
                    : {}
                }
                onChanged={handleAdvancedChanged}
                disabled={disabled}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
