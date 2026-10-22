/**
 * 回复设置菜单（详略 + 快速模式）—— 输入区入口
 *
 * 背景（2026-10-22）：`/effort` 与 `/fast` 的后端链路已补齐（会话 metadata + 路由分流），
 * 但 GUI 用户没有可点的入口 ⇒ 本组件把两条命令接到输入区。
 *
 * **事实来源与写入路径**（不另造一套状态）：
 *  - 详略：读会话 `metadata.effortLevel`（后端 system prompt 侧消费）；
 *    写走 `POST /v1/commands/execute { command: "effort <level>", session_id }`
 *    —— 与斜杠命令**同一实现**（含内存 + 持久层双写）。
 *  - 快速模式：读全局配置 `fastMode`（`GET /v1/config/fastMode`，由后端 `resolveSmartModel` 消费）；
 *    写走 `{ command: "fast on|off" }` —— 同样复用命令实现（含持久化与分析埋点）。
 *
 * 两者都是"下一轮生效"的偏好，不打断当前流式回合，故不在流式期间禁用。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReplyEffortLevel } from "@/types";
import { configService } from "@/services/configService";
import { runCommand } from "@/services/commandService";
import { handleClientError } from "@/utils/handleError";
import { toastError } from "@/stores/toastStore";

/** 四个详略档（顺序即菜单顺序：默认 → 更详） */
const EFFORT_LEVELS: readonly ReplyEffortLevel[] = [
  "auto",
  "low",
  "medium",
  "high",
];

/** 档位 → i18n 键（展示名唯一来源） */
const EFFORT_LABEL_KEY: Record<ReplyEffortLevel, string> = {
  auto: "chat.effortAuto",
  low: "chat.effortLow",
  medium: "chat.effortMedium",
  high: "chat.effortHigh",
};

interface ReplyPrefsMenuProps {
  /** 绑定会话 id（详略是会话级偏好）；缺省时详略区禁用，快速模式仍可用 */
  sessionId?: string;
  /** 当前详略档；`undefined` 按默认 `auto` 显示 */
  effortLevel?: ReplyEffortLevel;
  /** 详略切换成功回调：调用方就地更新本地会话缓存 */
  onEffortChanged?: (level: ReplyEffortLevel) => void;
}

export default function ReplyPrefsMenu({
  sessionId,
  effortLevel,
  onEffortChanged,
}: ReplyPrefsMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [effortPending, setEffortPending] = useState(false);
  const [fastPending, setFastPending] = useState(false);
  /** `null` = 尚未读到（不猜测；读到 `false` 才显示为关） */
  const [fastMode, setFastMode] = useState<boolean | null>(null);

  const current: ReplyEffortLevel = effortLevel ?? "auto";

  // 关闭：点面板外任意处 / 按 Esc。
  // 用 document 级监听而非"铺满全屏的透明遮罩"——输入区处于多层容器内，
  // 遮罩会被 z-index 更高的兄弟节点盖住，实测点击外部关不掉（2026-10-22 真机复现）。
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

  // 快速模式是全局偏好：挂载时读一次（单个 GET，不随会话变化）
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

  const handleEffort = useCallback(
    async (level: ReplyEffortLevel) => {
      if (!sessionId || effortPending) return;
      if (level === current) {
        setOpen(false);
        return;
      }
      setEffortPending(true);
      try {
        const result = await runCommand(`effort ${level}`, sessionId);
        if (!result.success) {
          // 失败必须让用户知道（不静默假装切换成功，CS03）
          toastError(new Error(result.error || t("chat.effortUpdateFailed")));
          return;
        }
        onEffortChanged?.(level);
        setOpen(false);
      } catch (err) {
        handleClientError(err, {
          module: "components:chat:ReplyPrefsMenu",
          action: "setEffort",
        });
        toastError(new Error(t("chat.effortUpdateFailed")));
      } finally {
        setEffortPending(false);
      }
    },
    [sessionId, effortPending, current, onEffortChanged, t],
  );

  const handleToggleFast = useCallback(async () => {
    if (fastPending || fastMode === null) return;
    const next = !fastMode;
    setFastPending(true);
    try {
      const result = await runCommand(next ? "fast on" : "fast off");
      if (!result.success) {
        toastError(new Error(result.error || t("chat.fastModeUpdateFailed")));
        return;
      }
      setFastMode(next);
    } catch (err) {
      handleClientError(err, {
        module: "components:chat:ReplyPrefsMenu",
        action: "toggleFastMode",
      });
      toastError(new Error(t("chat.fastModeUpdateFailed")));
    } finally {
      setFastPending(false);
    }
  }, [fastPending, fastMode, t]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("chat.replyPrefsTitle")}
        title={t("chat.replyPrefsTitle")}
        className="flex items-center gap-1 rounded px-1 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
      >
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
          />
        </svg>
        <span>
          {t("chat.effortLabel")} · {t(EFFORT_LABEL_KEY[current])}
        </span>
        {fastMode === true && (
          <svg
            className="w-3 h-3 text-amber-500"
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path d="M11.3 1.05a.75.75 0 01.42.86L10.6 7h4.15a.75.75 0 01.55 1.26l-7.5 8.5a.75.75 0 01-1.3-.63L7.6 11H3.5a.75.75 0 01-.55-1.26l7.5-8.5a.75.75 0 01.85-.19z" />
          </svg>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t("chat.replyPrefsTitle")}
          className="absolute bottom-full left-0 z-20 mb-1 w-72 rounded-lg border border-gray-200 bg-white py-2 shadow-lg dark:border-gray-700 dark:bg-gray-800"
        >
          <div className="px-3 pb-1 text-xs font-medium text-gray-700 dark:text-gray-200">
            {t("chat.replyPrefsTitle")}
          </div>
          <div className="px-3 py-1">
            <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">
              {t("chat.effortLabel")}
            </div>
            <div
              className="flex gap-1"
              role="radiogroup"
              aria-label={t("chat.effortLabel")}
            >
              {EFFORT_LEVELS.map((level) => {
                const active = level === current;
                return (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={!sessionId || effortPending}
                    onClick={() => void handleEffort(level)}
                    className={`flex-1 rounded border px-1 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      active
                        ? "border-blue-300 bg-blue-50 text-blue-600 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                        : "border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
                    }`}
                  >
                    {t(EFFORT_LABEL_KEY[level])}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] leading-snug text-gray-400 dark:text-gray-500">
              {sessionId ? t("chat.effortHint") : t("chat.effortNeedsSession")}
            </p>
          </div>
          <div className="mt-1 border-t border-gray-100 px-3 pt-2 dark:border-gray-700">
            {/* 开关紧贴标题（与上方档位按钮同为左对齐），不要推到面板最右边：
                「快速模式」与它的开关离得太远时，眼睛要先跨过半行空白才能配对 */}
            <div className="flex items-center gap-2">
              <div className="text-xs text-gray-700 dark:text-gray-200">
                {t("chat.fastModeLabel")}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={fastMode === true}
                aria-label={t("chat.fastModeLabel")}
                disabled={fastMode === null || fastPending}
                onClick={() => void handleToggleFast()}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                  fastMode === true
                    ? "bg-blue-500"
                    : "bg-gray-300 dark:bg-gray-600"
                }`}
              >
                {/* 必须显式 left-0.5：absolute 且 left/right 为 auto 时，滑块按
                    <button> 默认的居中对齐落位 ⇒ 关闭态会看起来停在右半边 */}
                <span
                  className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                    fastMode === true ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-gray-400 dark:text-gray-500">
              {t("chat.fastModeHint")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
