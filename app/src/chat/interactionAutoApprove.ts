/**
 * 交互式提问的**自动代答**接线 —— 两条口径共用一处判定与注入：
 *
 * 1. U-02（2026-10-20 用户裁定「自动通过，记录审计」）：`UNATTENDED_MODE` 开启时
 *    任何会话的提问都直接代答，避免无人值守续跑被提问永久挂住。
 * 2. B7（2026-11-09，设计稿 §5-4）：demand（许愿式）会话的歧义问询**最多 1 次**；
 *    预算用尽后转自动代答，继续全自动推进，不再挂起等用户。
 *
 * 两条口径都走「判定 → 注入 `_userAnswers` → 审计日志」同一实现，避免两条编排链
 * （`ReActToolLoop` 流式 / `ChatManagerTAORAdapter` 非流式）各写一份；纯答复口径见
 * `@openliri/infra/utils/unattendedAnswers`。
 *
 * 行为边界：
 * - 工具必须声明 `requiresUserInteraction()`；否则永不代答；
 * - 生效时**不挂起、不发 question 事件**，直接把答复写进工具入参（注入前做冻结保护）；
 * - 两条口径都不成立时返回 `false`，调用方照旧等待用户。
 */
import { getLogger } from '@openliri/infra/monitoring';
import {
  isUnattendedMode,
  resolveUnattendedAnswers,
} from '@openliri/infra/utils/unattendedAnswers';
import { isDemandSession } from './autonomy';

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

/** 会话侧需要的最小形状（`ChatSession` 满足） */
export interface AutoAnswerSession {
  id: string;
  metadata?: unknown;
}

/** B7：本进程内已用掉问询预算的会话（跨重启由 `metadata.demandAskUsed` 兜底） */
const demandAsked = new Set<string>();

/** B7：落盘钩子（装配层注入；未注入 ⇒ 只记内存态） */
let persistDemandAskUsed: ((sessionId: string) => void) | undefined;

/** B12：代答留痕钩子（装配层注入；未注入 ⇒ 只记审计日志） */
let notifyDemandAutoAnswer:
  | ((input: { sessionId: string; answers: string[] }) => void)
  | undefined;

/**
 * B12（2026-11-09）：装配层注册「代答已在会话里留痕」的钩子（与落盘钩子同型）。
 *
 * 为什么需要：B7 的代答对用户完全无感（不产生 question 事件）⇒ 用户会以为模型"跳过了"
 * 自己的追问。钩子由装配层写入一条带结构化标记的助手消息，失败只告警（不影响工具执行）。
 */
export function setDemandAutoAnswerNoticeHook(
  fn: (input: { sessionId: string; answers: string[] }) => void
): void {
  notifyDemandAutoAnswer = fn;
}

/**
 * B12：代答提示文案（只陈述已作的选择，不臆造理由）。
 */
export function formatDemandAutoAnswerNotice(
  answers: readonly string[]
): string {
  const picked = answers
    .map((a) => a.trim())
    .filter((a) => a.length > 0)
    .join('、');
  return `📎 已按模型建议自动作答：${picked}（本次会话的问询额度已用完，继续自动推进）`;
}

/**
 * B7 装配层注册落盘钩子（与 `setTaskSessionPolicyPort` 同型：端口一次注入，避免逐入口漏接）。
 * 钩子只负责把 `metadata.demandAskUsed` 写进会话存储，失败由钩子自身告警（内存态已生效）。
 */
export function setDemandAskPersistHook(fn: (sessionId: string) => void): void {
  persistDemandAskUsed = fn;
}

/** B7 记账：demand 会话已发出其唯一允许的一次问询（内存标记 + 落盘） */
export function noteDemandAsk(session: AutoAnswerSession): void {
  if (!isDemandSession(session.metadata)) return;
  demandAsked.add(session.id);
  if (session.metadata && typeof session.metadata === 'object') {
    (session.metadata as Record<string, unknown>).demandAskUsed = true;
  }
  persistDemandAskUsed?.(session.id);
}

/** 预算是否已用尽（内存标记 ∪ 已落盘的元数据标记） */
function isDemandAskUsed(session: AutoAnswerSession): boolean {
  if (demandAsked.has(session.id)) return true;
  const meta = session.metadata as { demandAskUsed?: unknown } | undefined;
  return meta?.demandAskUsed === true;
}

/**
 * B7 重置该会话的问询预算（内存标记 + 元数据标记）。
 *
 * 调用时机：会话自主度**真实变更**时（`SessionLifecycleManager._applyRequestAutonomy`）
 * ⇒ 切回 demand 重新获得 1 次问询额度；同值请求不触发（否则每轮都会被重置）。
 */
export function resetDemandAskBudget(session: AutoAnswerSession): void {
  demandAsked.delete(session.id);
  if (session.metadata && typeof session.metadata === 'object') {
    delete (session.metadata as Record<string, unknown>).demandAskUsed;
  }
}

/**
 * 是否代答（不挂起）。
 *
 * @param isRecovery 该调用是同一问询的**重放**（恢复态）⇒ 不代答，用户答案仍按原链路注入。
 * @returns `true`＝已完成自动答复（调用方**跳过**挂起等待，直接执行工具）。
 */
export function autoAnswerUnattended(
  tool: InteractionToolShape | undefined,
  call: InteractionCallShape,
  session: AutoAnswerSession,
  isRecovery?: boolean
): boolean {
  if (tool?.requiresUserInteraction?.() !== true) {
    return false;
  }
  const unattended = isUnattendedMode();
  // B7：demand 会话的问询预算已用尽（恢复态不代答，避免覆盖用户已给的答案）
  const demandSpent =
    isRecovery !== true &&
    isDemandSession(session.metadata) &&
    isDemandAskUsed(session);
  if (!unattended && !demandSpent) {
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
    sessionId: session.id,
    toolCallId: call.id,
    toolName: call.name,
    questionType: raw.questionType ?? 'choice',
    answers,
    reason: unattended ? 'unattended-auto-approve' : 'demand-ask-exhausted',
  });
  // B12：仅"问询预算用尽"这一支需要在会话里留痕（无人值守模式本就无人在看）
  if (demandSpent) notifyDemandAutoAnswer?.({ sessionId: session.id, answers });
  return true;
}
