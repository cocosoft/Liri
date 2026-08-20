/**
 * DecisionGate — 协商式执行引擎的提问门控中间件（设计方案 §5）
 *
 * 三层门控：
 *  1. 分析必出清单（plan 阶段）：AI 分析后必须列出待确认点，不允许直接执行
 *  2. 关键决策拦截（execute 阶段）：选型/范围偏离/外部操作/结果不符时拦截
 *  3. 子任务汇报循环（review 阶段）：每子任务完成后问"继续/调整/回退"
 *
 * 门控强度映射（GateTier → GateSignal 拦截项）：
 *  - strict：全部四类信号拦截
 *  - moderate（默认）：仅 external_action + unexpected_result 拦截
 *  - relaxed：仅 external_action 拦截
 */

import { getLogger } from '@modules/monitoring';

const logger = getLogger('chat:decisionGate');

// ─── 类型定义 ──────────────────────────────────────────

/** 门控强度（对齐设计方案 §5.3 + §7.3 配置项"提问门控强度"） */
export type GateTier = 'strict' | 'moderate' | 'relaxed';

/** 可判定信号（对齐设计方案 §5.3） */
export type GateSignal =
  | { kind: 'selection'; toolName: string; field: string }
  | { kind: 'scope_drift'; deltaPct: number; detail: string }
  | { kind: 'external_action'; toolName: string }
  | { kind: 'unexpected_result'; toolName: string; detail: string };

/** 待确认问题（对齐设计方案 §5.2 PendingQuestion） */
export interface PendingQuestion {
  id: string;
  type: 'choice' | 'open' | 'confirm';
  question: string;
  options?: string[];
  rationale: string;
  stage: 'plan' | 'execute' | 'review';
  signal?: GateSignal;
  askedAt?: number;
}

/** 门控阶段 */
export type GatePhase = 'plan' | 'execute' | 'review';

/** 工具执行步骤上下文（供 shouldAsk 判定） */
export interface StepContext {
  toolName: string;
  toolInput: Record<string, unknown>;
  /** 上一轮工具的结果（用于 unexpected_result 判定） */
  prevResult?: { success: boolean; error?: string };
  /** 当前大纲节点数（用于 scope_drift 判定） */
  outlineNodeCount?: number;
  /** 初始大纲节点数（基准） */
  baselineNodeCount?: number;
}

// ─── 需确认工具白名单 ────────────────────────────────────

/**
 * 外部操作工具白名单（命中即触发 external_action 信号）
 * 发消息 / 写外部系统 / 付费调用 等有副作用的操作
 */
const EXTERNAL_ACTION_TOOLS = new Set([
  'send_message',
  'send_email',
  'create_channel_message',
  'publish_to_external',
  'create_task',
  'update_task',
  'delete_task',
  'git_push',
  'git_commit',
  'npm_publish',
  'deploy',
]);

/**
 * 选型工具参数字段（含这些字段变更时触发 selection 信号）
 */
const SELECTION_FIELDS = new Set(['model', 'provider', 'template', 'format']);

// ─── 信号判定 ──────────────────────────────────────────

/**
 * 判定工具执行步骤的信号类型
 * 返回 null 表示无信号（放行）
 */
export function classifySignal(step: StepContext): GateSignal | null {
  const {
    toolName,
    toolInput,
    prevResult,
    outlineNodeCount,
    baselineNodeCount,
  } = step;

  // 1. external_action：工具在白名单中
  if (EXTERNAL_ACTION_TOOLS.has(toolName)) {
    return { kind: 'external_action', toolName };
  }

  // 2. selection：工具参数含 model/provider 等选型字段
  for (const field of SELECTION_FIELDS) {
    if (field in toolInput) {
      return { kind: 'selection', toolName, field };
    }
  }

  // 3. unexpected_result：上一轮工具返回失败
  if (prevResult && !prevResult.success) {
    return {
      kind: 'unexpected_result',
      toolName,
      detail: prevResult.error ?? '工具执行失败',
    };
  }

  // 4. scope_drift：大纲节点数变化 >20%
  if (
    outlineNodeCount !== undefined &&
    baselineNodeCount !== undefined &&
    baselineNodeCount > 0
  ) {
    const deltaPct =
      Math.abs(outlineNodeCount - baselineNodeCount) / baselineNodeCount;
    if (deltaPct > 0.2) {
      return {
        kind: 'scope_drift',
        deltaPct: Math.round(deltaPct * 100),
        detail: `大纲节点数从 ${baselineNodeCount} 变为 ${outlineNodeCount}（${Math.round(deltaPct * 100)}%）`,
      };
    }
  }

  return null;
}

/**
 * 判定信号在给定门控强度下是否需要拦截
 */
export function isIntercepted(signal: GateSignal, tier: GateTier): boolean {
  switch (tier) {
    case 'strict':
      // 全部四类信号拦截
      return true;
    case 'moderate':
      // 仅 external_action + unexpected_result 拦截
      return (
        signal.kind === 'external_action' || signal.kind === 'unexpected_result'
      );
    case 'relaxed':
      // 仅 external_action 拦截
      return signal.kind === 'external_action';
  }
}

/**
 * 根据信号构建待确认问题
 */
function buildPendingQuestion(
  signal: GateSignal,
  step: StepContext,
  phase: GatePhase
): PendingQuestion {
  const id = `gate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  switch (signal.kind) {
    case 'selection':
      return {
        id,
        type: 'choice',
        question: `工具 ${step.toolName} 将使用 ${signal.field}=${String(step.toolInput[signal.field])}，是否确认？`,
        rationale: `选型决策影响后续执行路径，需用户确认。`,
        stage: phase,
        signal,
      };

    case 'scope_drift':
      return {
        id,
        type: 'confirm',
        question: `检测到范围偏离：${signal.detail}。是否继续？`,
        rationale: '执行范围与初始确认的大纲偏差较大，需用户确认是否继续。',
        stage: phase,
        signal,
      };

    case 'external_action':
      return {
        id,
        type: 'confirm',
        question: `工具 ${signal.toolName} 将执行外部操作（有副作用），是否确认？`,
        rationale:
          '外部操作（发消息/写外部系统/付费调用）不可撤销，需用户确认。',
        stage: phase,
        signal,
      };

    case 'unexpected_result':
      return {
        id,
        type: 'choice',
        question: `工具 ${signal.toolName} 上一步执行失败：${signal.detail}。如何处理？`,
        options: ['重试', '跳过', '中止'],
        rationale: '工具执行结果与预期不符，需用户决策后续动作。',
        stage: phase,
        signal,
      };
  }
}

// ─── 核心门控函数 ────────────────────────────────────────

/**
 * 提问门控：执行动作前的统一检查
 *
 * @param step 当前工具执行步骤的上下文
 * @param tier 门控强度
 * @param phase 门控阶段（plan/execute/review）
 * @returns 需要拦截时返回 PendingQuestion，放行时返回 null
 */
export function shouldAsk(
  step: StepContext,
  tier: GateTier,
  phase: GatePhase = 'execute'
): PendingQuestion | null {
  const signal = classifySignal(step);
  if (!signal) return null;

  if (!isIntercepted(signal, tier)) {
    logger.debug('decisionGate:signal_not_intercepted', {
      tier,
      signalKind: signal.kind,
      toolName: step.toolName,
    });
    return null;
  }

  const question = buildPendingQuestion(signal, step, phase);
  question.askedAt = Date.now();

  logger.info('decisionGate:should_ask', {
    tier,
    phase,
    signalKind: signal.kind,
    toolName: step.toolName,
    questionId: question.id,
    question: question.question.slice(0, 100),
  });

  return question;
}

// ─── 提问超时判定 ────────────────────────────────────────

/**
 * 判定提问是否超时
 *
 * @param askedAt 提问时间戳
 * @param thresholdMs 超时阈值（默认 5 分钟）
 * @returns 'ok' 未超时 / 'warn' 接近超时（达阈值） / 'timeout' 超时（达 2 倍阈值）
 */
export function checkTimeout(
  askedAt: number,
  thresholdMs: number = 5 * 60 * 1000
): 'ok' | 'warn' | 'timeout' {
  const elapsed = Date.now() - askedAt;
  if (elapsed >= thresholdMs * 2) return 'timeout';
  if (elapsed >= thresholdMs) return 'warn';
  return 'ok';
}

/**
 * 超时自动降级策略
 *
 * - choice：取首个选项
 * - confirm：默认"确认"
 * - open：跳过该步骤
 */
export function defaultAnswerForTimeout(
  question: PendingQuestion
): string[] | null {
  switch (question.type) {
    case 'choice':
      return question.options?.slice(0, 1) ?? null;
    case 'confirm':
      return ['确认'];
    case 'open':
      return null; // 跳过
  }
}
