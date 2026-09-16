/**
 * 工作模式徽标（Plan/Do）—— **展示层**，事实来源为会话 `metadata.workMode`
 *
 * 背景：`work_mode` 自 2026-09-14 起已端到端生效（会话 metadata → 请求体 → 后端消费，
 * 后端在 plan 模式会拒绝写操作并要求用户确认进入 Do），但**前端从未把该状态显示给用户**
 * → 用户看到 AI 突然拒绝写文件却不知道原因。本组件补上这一处可见性。
 *
 * 复用既有 i18n 键 `workspace.plan` / `workspace.do`（此前存在于语言包但零消费）。
 * 未设置模式（`undefined`）时**不渲染任何内容**（不臆造状态）。
 */

import { useTranslation } from "react-i18next";
import type { WorkMode } from "@/types";

interface WorkModeBadgeProps {
  /** 会话的工作模式；`undefined` 表示后端未设置 → 不渲染 */
  workMode?: WorkMode;
  /** 额外类名（调用方控制间距/尺寸时用） */
  className?: string;
}

export default function WorkModeBadge({
  workMode,
  className = "",
}: WorkModeBadgeProps) {
  const { t } = useTranslation();

  if (workMode !== "plan" && workMode !== "do") {
    return null;
  }

  const isPlan = workMode === "plan";
  const label = isPlan ? t("workspace.plan") : t("workspace.do");
  // 计划=琥珀（先想清楚再动手）、执行=绿（可落地产出）
  const tone = isPlan
    ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-600 dark:bg-amber-900/30 dark:text-amber-300"
    : "border-green-300 bg-green-50 text-green-700 dark:border-green-600 dark:bg-green-900/30 dark:text-green-300";

  return (
    <span
      title={
        isPlan
          ? t("workspace.planDoToggle") + " → " + t("workspace.plan")
          : t("workspace.planDoToggle") + " → " + t("workspace.do")
      }
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] leading-none ${tone} ${className}`}
    >
      {label}
    </span>
  );
}
