/**
 * 回答模式的单色图标（A′ v4，2026-11-05）
 *
 * 背景：emoji 图标在不同平台/字体下渲染差异很大（同一档位在 Windows 与 macOS
 * 可能完全两个样子），且与界面其余线性图标风格不一致。这里统一改为
 * `currentColor` 线性图标，尺寸由调用方通过 `className` 控制。
 */
import type { ReactNode } from "react";
import type { ReplyMode } from "./replyModeOptions";

const ICONS: Record<ReplyMode, ReactNode> = {
  auto: (
    <>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
      <path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z" />
    </>
  ),
  quick: <path d="M13 2L4.5 13.5H11l-1 8.5L19.5 10H13z" />,
  deep: (
    <>
      <path d="M9.5 18h5" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 00-3.5 10.9c.4.3.5.7.5 1.1v1h6v-1c0-.4.1-.8.5-1.1A6 6 0 0012 3z" />
    </>
  ),
  code: (
    <>
      <path d="M8 6l-5 6 5 6" />
      <path d="M16 6l5 6-5 6" />
    </>
  ),
  creative: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
    </>
  ),
  research: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
};

export default function ReplyModeIcon({
  mode,
  className = "h-3.5 w-3.5",
}: {
  mode: ReplyMode;
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
