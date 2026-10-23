/**
 * 无人值守模式下的**交互式提问自动答复**（U-02，2026-10-20 用户裁定「自动通过，记录审计」）。
 *
 * 背景：`ask_user_question` 在流式 / 非流式两条编排链上都会挂起等待用户输入
 * （`ReActToolLoop` / `ChatManagerTAORAdapter`）⇒ 无人值守自动续跑一旦遇到提问就永久停住，
 * 与「全自动」目标冲突。
 *
 * 口径（**只在 `UNATTENDED_MODE` 开启时生效**，普通交互零变化）：
 * - `confirm`：选「确认」类选项（找不到则取第一个选项）；
 * - `choice`：取第一个选项（模型给的第一个选项即其建议项）；
 * - `open`：无法代答 ⇒ 返回显式占位，提示模型按最佳判断继续，**不伪造用户具体输入**；
 * - 调用方必须记录 `interaction_auto_answered` 审计日志（含题型与所选项）。
 *
 * 与 `agent/tool-policy` 的 owner-only 审批**无关**：本模块只处理「阶段提问」，不碰危险操作审批。
 */
import { feature } from '@openliri/kernel';

/** 交互提问的最小形状（`ask_user_question` 的入参子集） */
export interface UnattendedQuestionShape {
  /** `choice` | `open` | `confirm`（缺省按 `choice`） */
  questionType?: string;
  /** 可选项（`label` 为用户可见文本） */
  options?: ReadonlyArray<{ label?: string }>;
}

/** 是否处于无人值守模式（唯一开关 `UNATTENDED_MODE`；env 覆盖 `FEATURE_UNATTENDED_MODE`） */
export function isUnattendedMode(): boolean {
  return feature('UNATTENDED_MODE');
}

/** 「确认」类选项的识别词（中英文；命中即优先选它） */
const CONFIRM_POSITIVE_HINTS = [
  '确认',
  '确定',
  '继续',
  '同意',
  '是',
  'approve',
  'confirm',
  'continue',
  'yes',
] as const;

/** `open` 题型无法代答时的显式占位（不伪造用户输入） */
const OPEN_PLACEHOLDER =
  '（无人值守自动通过：未提供具体输入，请按你的最佳判断继续）';

/**
 * 计算无人值守下的自动答复。
 *
 * @returns 要注入 `_userAnswers` 的答案数组；调用方据「非空」判定走自动通过分支。
 */
export function resolveUnattendedAnswers(
  question: UnattendedQuestionShape
): string[] {
  const labels = (question.options ?? [])
    .map((option) => (option.label ?? '').trim())
    .filter((label) => label.length > 0);
  const questionType = question.questionType ?? 'choice';

  if (questionType === 'open') {
    return [OPEN_PLACEHOLDER];
  }

  if (questionType === 'confirm') {
    const positive = labels.find((label) =>
      CONFIRM_POSITIVE_HINTS.some((hint) =>
        label.toLowerCase().includes(hint.toLowerCase())
      )
    );
    return [positive ?? labels[0] ?? '确认'];
  }

  // choice（含 multiSelect）：取第一个选项 = 模型建议项
  return labels.length > 0 ? [labels[0]!] : [OPEN_PLACEHOLDER];
}
