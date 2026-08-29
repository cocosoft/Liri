/**
 * ReviewGate — PDCA 审查/决策门组件
 *
 * 组件化目标（对标 dsh 的 everything-is-a-plugin 思路中的质量维度）：
 *   REVIEW + DECIDE 两个阶段从 LongRunningTaskOrchestrator 内建逻辑中抽出，
 *   变为可替换组件。默认实现保持原行为（LLM Reviewer + VerifierAgent 双指标 +
 *   机械验证），外部可注入自定义门（如规则审查、阈值调整、禁用审查）。
 *
 * 挂载方式：
 *   const gate = createReviewGate({ passThreshold: 80 });
 *   orchestrator.setReviewGate(gate);
 *
 * 环境变量（运行时切换，无需改代码）：
 *   PDCA_REVIEW_GATE          = 'default' | 'disabled' | 'lenient' | 'strict'
 *   PDCA_REVIEW_PASS_THRESHOLD = 0-100（默认按 isReviewPassed：critical/major 阻塞）
 *   PDCA_REVIEW_MECHANICAL    = 'true' | 'false'（机械验证开关，默认 true）
 *   PDCA_REVIEW_VERIFIER      = 'true' | 'false'（VerifierAgent 双指标开关，默认 true）
 */

import { getLogger } from '@modules/monitoring';
import { configManager } from '@modules/config';
import { parseReviewFromText } from '../PlanReview.js';
import type { PlanReview, ReviewDecision, ReviewIssue } from '../PlanReview.js';
import type { AgentIsolation } from '@modules/agent';
import type { VerifierAgent } from '@modules/query';
import type { PlanStep } from '../TaskOrchestrator.js';

const logger = getLogger('tasks:reviewGate');

/** 审查门执行上下文（由 Orchestrator 注入运行时依赖） */
export interface ReviewGateContext {
  taskId: string;
  planId: string;
  step: PlanStep;
  isolation: AgentIsolation;
  executor: (params: {
    systemPrompt: string;
    userPrompt: string;
    tools: string[];
    isolation: AgentIsolation;
  }) => Promise<string>;
  verifier: VerifierAgent;
}

/** 审查门配置 */
export interface ReviewGateConfig {
  /** 审查模式：default / disabled / lenient / strict */
  mode: 'default' | 'disabled' | 'lenient' | 'strict';
  /** 分数阈值（0-100）：低于该分数视为不通过（默认 0 = 不启用分数门槛） */
  passThreshold: number;
  /** 是否启用机械验证（verifyProject） */
  enableMechanicalVerify: boolean;
  /** 是否启用 VerifierAgent 双指标验证 */
  enableVerifier: boolean;
  /** 阻塞性 severity 列表（默认 critical + major） */
  blockingSeverities: Array<ReviewIssue['severity']>;
  /** 最大重试次数（decide 决策用） */
  maxRetries: number;
}

/**
 * ReviewGate 接口 —— REVIEW + DECIDE 两个阶段的组件契约。
 *
 * 实现方只需关心"如何审查"与"如何决策"，
 * 状态变更（markStepFailed / retryCount++ 等）仍由 Orchestrator 负责。
 */
export interface ReviewGate {
  readonly name: string;
  /** 读取（或合并）配置 */
  getConfig(): Readonly<ReviewGateConfig>;
  /** 执行审查，返回 PlanReview（不修改步骤状态） */
  reviewStep(ctx: ReviewGateContext): Promise<PlanReview>;
  /** 根据审查结果给出决策建议（approve / retry / skip / escalate） */
  decide(ctx: ReviewGateContext): Promise<ReviewDecision>;
  /** 该步骤是否需要走审查门（false 时调用方直接 approve） */
  shouldReview(ctx: ReviewGateContext): boolean;
}

/** 默认配置 */
export const DEFAULT_REVIEW_GATE_CONFIG: ReviewGateConfig = {
  mode: 'default',
  passThreshold: 0,
  enableMechanicalVerify: true,
  enableVerifier: true,
  blockingSeverities: ['critical', 'major'],
  maxRetries: 3,
};

/** 按 mode 应用预设（lenient / strict / disabled 覆盖部分配置） */
export function applyModePresets(cfg: ReviewGateConfig): ReviewGateConfig {
  const next: ReviewGateConfig = { ...cfg };
  if (next.mode === 'disabled') {
    next.enableMechanicalVerify = false;
    next.enableVerifier = false;
  } else if (next.mode === 'lenient') {
    next.blockingSeverities = ['critical'];
    next.passThreshold = next.passThreshold || 40;
  } else if (next.mode === 'strict') {
    next.blockingSeverities = ['critical', 'major', 'minor'];
    next.passThreshold = next.passThreshold || 80;
  }
  return next;
}

/** 从环境变量加载配置（运行时切换模式） */
export function loadReviewGateConfigFromEnv(): ReviewGateConfig {
  const rawMode = configManager.env('PDCA_REVIEW_GATE') || 'default';
  const mode =
    rawMode === 'disabled' || rawMode === 'lenient' || rawMode === 'strict'
      ? rawMode
      : 'default';

  const rawThreshold = configManager.env('PDCA_REVIEW_PASS_THRESHOLD');
  const passThreshold =
    rawThreshold && !isNaN(Number(rawThreshold))
      ? Math.max(0, Math.min(100, Number(rawThreshold)))
      : DEFAULT_REVIEW_GATE_CONFIG.passThreshold;

  const cfg: ReviewGateConfig = {
    ...DEFAULT_REVIEW_GATE_CONFIG,
    mode,
    passThreshold,
    enableMechanicalVerify:
      configManager.env('PDCA_REVIEW_MECHANICAL') !== 'false',
    enableVerifier: configManager.env('PDCA_REVIEW_VERIFIER') !== 'false',
  };

  return applyModePresets(cfg);
}

/** 从 config.json 读取 UI 配置面板写入的审查门配置（不存在返回 undefined） */
export function loadReviewGateConfigFromSettings():
  | Partial<ReviewGateConfig>
  | undefined {
  try {
    const raw = configManager.getConfigValue('pdca.review.gate') as
      | Partial<ReviewGateConfig>
      | undefined;
    if (raw && typeof raw === 'object') {
      return raw;
    }
  } catch {
    // @ignore-catch: 配置读取失败回退环境变量
  }
  return undefined;
}

/**
 * 加载审查门配置：config.json（UI 面板写入）优先，环境变量回退。
 * 优先级：显式 config 参数 > config.json > 环境变量 > 默认值。
 */
export function loadReviewGateConfig(): ReviewGateConfig {
  const fromSettings = loadReviewGateConfigFromSettings();
  return applyModePresets({
    ...loadReviewGateConfigFromEnv(),
    ...fromSettings,
  });
}

/** 组装 Reviewer prompt（机械验证结果作为上下文注入） */
async function buildReviewPrompt(
  step: PlanStep,
  enableMechanicalVerify: boolean
): Promise<string> {
  let mechanicalVerify = '';
  if (enableMechanicalVerify) {
    try {
      const { verifyProject } = await import('../../query/verifyProject.js');
      const verifyResult = await Promise.race([
        verifyProject(),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('verify_timeout')), 30000)
        ),
      ]).catch((err) => `verify skipped: ${String(err)}`);
      if (typeof verifyResult === 'string' && verifyResult) {
        mechanicalVerify = verifyResult;
      }
    } catch {
      // @ignore-catch: 机械验证失败不阻塞 Review（降级为仅语义审查）
    }
  }

  return [
    `审查以下步骤的执行结果：`,
    `步骤: ${step.description}`,
    step.acceptanceCriteria ? `验收标准: ${step.acceptanceCriteria}` : '',
    `实际输出: ${step.result || '(无输出)'}`,
    mechanicalVerify ? `机械验证结果:\n${mechanicalVerify}` : '',
    `请输出 JSON 审查结果: {"pass":bool,"score":0-100,"issues":[{"severity":"critical|major|minor","description":"..."}],"summary":"..."}`,
  ].join('\n');
}

/**
 * 默认审查门 —— 迁移自 LongRunningTaskOrchestrator.reviewStep / autoDecideStep 原逻辑：
 *   1. 机械验证（verifyProject，可选）作为 Reviewer 输入上下文
 *   2. LLM Reviewer 语义审查（JSON 解析 + 降级行分割）
 *   3. VerifierAgent 双指标判定融合（REJECT / ESCALATE 覆盖）
 *   4. decide：isReviewPassed + 分数阈值 + 重试上限
 */
export class DefaultReviewGate implements ReviewGate {
  readonly name = 'default';
  private config: ReviewGateConfig;

  constructor(config?: Partial<ReviewGateConfig>) {
    this.config = { ...DEFAULT_REVIEW_GATE_CONFIG, ...config };
  }

  getConfig(): Readonly<ReviewGateConfig> {
    return { ...this.config };
  }

  shouldReview(_ctx: ReviewGateContext): boolean {
    return this.config.mode !== 'disabled';
  }

  async reviewStep(ctx: ReviewGateContext): Promise<PlanReview> {
    const { step, isolation, executor } = ctx;
    const reviewPrompt = await buildReviewPrompt(
      step,
      this.config.enableMechanicalVerify
    );

    const reviewText = await executor({
      systemPrompt:
        '你是一个任务审查员。对比验收标准和实际执行结果，给出审查意见。只读操作，不修改任何文件。输出 JSON 格式：{"pass":bool,"score":0-100,"issues":[],"summary":"..."}',
      userPrompt: reviewPrompt,
      tools: ['search', 'file'],
      isolation,
    });

    const review = parseReviewFromText(reviewText, step.id);

    // VerifierAgent 双指标验证（REJECT / ESCALATE 覆盖 Reviewer 判定）
    if (this.config.enableVerifier) {
      try {
        const verifyResult = await ctx.verifier.verify(
          {
            messages: [
              {
                role: 'system',
                content:
                  '你是一个任务审查员。对比验收标准和实际执行结果，给出审查意见。只读操作，不修改任何文件。输出 JSON 格式：{"pass":bool,"score":0-100,"issues":[],"summary":"..."}',
              },
              { role: 'user', content: reviewPrompt },
              { role: 'assistant', content: reviewText },
            ],
            toolResults: [],
            turnCount: 0,
            sessionId: ctx.taskId,
          },
          isolation.abortController.signal
        );

        const { passed, confidence, verdict } = verifyResult;
        if (!passed) {
          if (verdict === 'REJECT') {
            review.pass = false;
            review.issues.push({
              severity: 'major',
              description: `VerifierAgent REJECT: confidence=${confidence.toFixed(2)}`,
            });
          } else if (verdict === 'ESCALATE') {
            review.pass = false;
            review.issues.push({
              severity: 'critical',
              description: `VerifierAgent ESCALATE: confidence=${confidence.toFixed(2)}，需人工介入。反馈：${verifyResult.feedback || '无'}`,
            });
          }
        }
      } catch (verifyErr) {
        logger.warn(
          'VerifierAgent failed in reviewStep, continuing with Reviewer score only',
          { error: String(verifyErr) }
        );
      }
    }

    return review;
  }

  /**
   * 决策建议：
   *   pass 且（无分数门槛 或 分数达标）→ approved
   *   未过且 retryCount < maxRetries → retry
   *   否则 → escalate
   */
  async decide(ctx: ReviewGateContext): Promise<ReviewDecision> {
    const { step } = ctx;
    const review = step.reviewResult;
    // 优先步骤自身 maxRetries（与 Orchestrator 原逻辑一致），否则用门配置
    const maxRetries = step.maxRetries ?? this.config.maxRetries;

    if (!review) {
      return step.retryCount < maxRetries ? 'retry' : 'escalate';
    }

    // 1. 阻塞级 issue 判定（blockingSeverities 可配置）
    const blocking = review.issues.filter((i) =>
      this.config.blockingSeverities.includes(i.severity)
    );
    const passed = review.pass && blocking.length === 0;

    // 2. 分数门槛（可配）
    const scorePassed =
      this.config.passThreshold === 0 ||
      review.score >= this.config.passThreshold;

    if (passed && scorePassed) return 'approved';
    if (step.retryCount < maxRetries) return 'retry';
    return 'escalate';
  }
}

/**
 * 禁用门 —— 不做审查，直接批准（用于快速通道 / 基准测试）
 */
export class NoopReviewGate implements ReviewGate {
  readonly name = 'noop';
  private config: ReviewGateConfig;

  constructor(config?: Partial<ReviewGateConfig>) {
    this.config = {
      ...DEFAULT_REVIEW_GATE_CONFIG,
      ...config,
      mode: 'disabled',
    };
  }

  getConfig(): Readonly<ReviewGateConfig> {
    return { ...this.config };
  }

  shouldReview(_ctx: ReviewGateContext): boolean {
    return false;
  }

  async reviewStep(_ctx: ReviewGateContext): Promise<PlanReview> {
    return {
      stepId: '',
      pass: true,
      score: 100,
      issues: [],
      summary: 'review disabled',
      reviewedAt: Date.now(),
    };
  }

  async decide(_ctx: ReviewGateContext): Promise<ReviewDecision> {
    return 'approved';
  }
}

/**
 * 工厂：根据配置创建审查门。
 * 未传入 config 时按优先级加载：config.json（UI 面板）> 环境变量 > 默认值。
 */
export function createReviewGate(
  config?: Partial<ReviewGateConfig>
): ReviewGate {
  const merged: ReviewGateConfig = applyModePresets({
    ...loadReviewGateConfig(),
    ...config,
  });

  if (merged.mode === 'disabled') return new NoopReviewGate(merged);

  return new DefaultReviewGate(merged);
}
