/**
 * 权限模式的单色图标（A′ v4，2026-11-05）
 *
 * 取代原 `PERMISSION_MODE_SYMBOLS`（emoji/符号混排，跨平台渲染不一致）。
 * 图标语义与后端档位一一对应，尺寸由调用方通过 `className` 控制。
 */
import type { ReactNode } from "react";
import type { SessionPermissionMode } from "@/types";

const ICONS: Record<SessionPermissionMode, ReactNode> = {
  default: (
    <>
      <path d="M12 3l7 3v5.5c0 4.5-3 7.6-7 9.5-4-1.9-7-5-7-9.5V6z" />
      <path d="M9.5 11.5l1.8 1.8 3.4-3.4" />
    </>
  ),
  plan: (
    <>
      <rect x="7" y="5" width="3.2" height="14" rx="1" />
      <rect x="13.8" y="5" width="3.2" height="14" rx="1" />
    </>
  ),
  auto: (
    <>
      <path d="M20 12a8 8 0 10-2.3 5.7" />
      <path d="M20 5v5h-5" />
    </>
  ),
  dontAsk: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </>
  ),
  bypass: <path d="M13 2L4.5 13.5H11l-1 8.5L19.5 10H13z" />,
};

export default function PermissionModeIcon({
  mode,
  className = "h-3.5 w-3.5",
}: {
  mode: SessionPermissionMode;
  className?: string;
}) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[mode]}
    </svg>
  );
}
