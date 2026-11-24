/**
 * 执行阶段（analyzing/designing/implementing/verifying/presenting）展示 ——
 * **单一事实源**（批次 4，2026-11-24）。
 *
 * 缺口（已收口）：原 `ProgressCard` 与 `StatusFloatBar` 各维护一份阶段 → 文案映射
 * （前者还多一份图标），新增阶段时容易只改一处；`ProgressCard` 已下线（2026-11-24）⇒
 * 现由 `StatusFloatBar` 单点使用。
 *
 * 口径：取值来自 `ProgressData["phase"]`；未登记取值 ⇒ 调用方回退显示原始枚举值
 * （不编造文案，见 CS06）。
 */
import type { ProgressData } from "../types";

export type ExecutionPhaseCode = ProgressData["phase"];

export interface ExecutionPhaseStyle {
  /** 图标（纯文本/emoji） */
  icon: string;
  /** 文案 i18n 键 */
  labelKey: string;
}

export const EXECUTION_PHASE_STYLES: Record<
  ExecutionPhaseCode,
  ExecutionPhaseStyle
> = {
  analyzing: { icon: "\u{1F50D}", labelKey: "chat.phaseAnalyzing" },
  designing: { icon: "\u{1F3D7}\uFE0F", labelKey: "chat.phaseDesigning" },
  implementing: { icon: "\u{1F527}", labelKey: "chat.phaseImplementing" },
  verifying: { icon: "\u2705", labelKey: "chat.phaseVerifying" },
  presenting: { icon: "\u{1F4CB}", labelKey: "chat.phasePresenting" },
};

/** 取执行阶段样式；未登记取值 ⇒ `undefined`（调用方回退原始值） */
export function getExecutionPhaseStyle(
  phase: string,
): ExecutionPhaseStyle | undefined {
  return EXECUTION_PHASE_STYLES[phase as ExecutionPhaseCode];
}
