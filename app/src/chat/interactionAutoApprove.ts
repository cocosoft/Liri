/**
 * 交互式提问的**无人值守自动答复**接线（U-02，2026-10-20 用户裁定「自动通过，记录审计」）。
 *
 * 两条编排链（`ReActToolLoop` 流式 / `ChatManagerTAORAdapter` 非流式）共用本函数，
 * 避免两处各写一份「判定 + 注入 + 审计」；纯答复口径见 `@modules/utils/unattendedAnswers`。
 *
 * 行为边界：
 * - 仅在 `UNATTENDED_MODE` 开启且工具声明 `requiresUserInteraction()` 时生效；
 * - 生效时**不挂起、不发 question 事件**，直接把答复写进工具入参 `_userAnswers`（注入前做冻结保护）；
 * - 普通路径（开关默认关）返回 `false`，调用方照旧等待用户。
 */
import { getLogger } from '@modules/monitoring';
import {
  isUnattendedMode,
  resolveUnattendedAnswers,
} from '@modules/utils/unattendedAnswers';

const logger = getLogger('chat:interactionAutoApprove');

/** 工具侧需要的最小形状 */
interface InteractionToolShape {
  requiresUserInteraction?: () => boolean;
}

/** 工具调用侧需要的最小形状（`ReActToolLoop` / TAOR 两条链的 `tc` 都满足） */
interface InteractionCallShape {
  id: string;
  name: string;
  /** 工具入参（ReAct 链字段名）；本函数会在需要时替换为可扩展副本 */
  input?: unknown;
  /** TAOR 链的入参字段名是 `arguments`（与 `input` 二选一） */
  arguments?: Record<string, unknown>;
}

/**
 * @returns `true`＝已完成自动答复（调用方**跳过**挂起等待，直接执行工具）。
 */
export function autoAnswerUnattended(
  tool: InteractionToolShape | undefined,
  call: InteractionCallShape,
  sessionId: string
): boolean {
  if (tool?.requiresUserInteraction?.() !== true || !isUnattendedMode()) {
    return false;
  }

  const raw = (call.input ?? call.arguments ?? {}) as Record<string, unknown>;
  const answers = resolveUnattendedAnswers({
    questionType: raw.questionType as string | undefined,
    options: raw.options as ReadonlyArray<{ label?: string }> | undefined,
  });

  // 注入 `_userAnswers`（入参可能是深冻结对象，先确保可扩展）
  if (call.arguments !== undefined) {
    call.arguments._userAnswers = answers;
  } else if (Object.isExtensible(raw)) {
    raw._userAnswers = answers;
  } else {
    call.input = { ...raw, _userAnswers: answers };
  }

  logger.warn('chat:interaction_auto_answered', {
    sessionId,
    toolCallId: call.id,
    toolName: call.name,
    questionType: raw.questionType ?? 'choice',
    answers,
    reason: 'unattended-auto-approve',
  });
  return true;
}
