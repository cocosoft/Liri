/**
 * PdcaEntryBadge — 浮动栏里的 PDCA 入口徽标（批次 14 P2-B，2026-11-24）。
 *
 * 三面分工中本徽标只做**会话级指示器 + 入口**：
 * - `active`（编排进行中）⇒ 「PDCA 编排」+ 蓝色脉冲点；
 * - `terminal`（本轮已结束，但该会话仍有 PDCA 可看）⇒ 「查看结果」+ 静态灰点。
 *
 * 两种形态点击都只做一件事：开合抽屉（唯一进度详情来源）。
 *
 * ⚠️ **不表达"等待审批"**：那是会话级状态（`StatusFloatBar` 左侧主状态点与文案承担，
 * 且含非 PDCA 审批）—— 在这里再造一份判据会与左侧自相矛盾（批次 14「不新增第二份判据」）。
 */
import { useTranslation } from "react-i18next";

export default function PdcaEntryBadge({
  active,
  open,
  onToggle,
}: {
  /** 编排进行中（蓝脉冲 / 「PDCA 编排」） */
  active: boolean;
  /** 抽屉是否已展开（aria-expanded 与高亮态） */
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const label = active ? t("chat.pdcaBadge") : t("chat.pdcaViewResult");
  const hint = active ? t("chat.pdcaBadgeHint") : t("chat.pdcaViewResultHint");

  return (
    <button
      type="button"
      onClick={(e) => {
        // 避免误触整条浮动栏的"展开任务面板"
        e.stopPropagation();
        onToggle();
      }}
      aria-expanded={open}
      aria-label={label}
      title={hint}
      className={`shrink-0 flex items-center gap-1 px-2 py-0.5 text-xs rounded-md transition-colors ${
        open
          ? "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300"
          : "text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full shrink-0 ${
          active ? "bg-blue-500 animate-pulse" : "bg-gray-400"
        }`}
      />
      <span>📊</span>
      <span>{label}</span>
    </button>
  );
}
