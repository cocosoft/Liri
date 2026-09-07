// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * CompetitiveStrategyOrchestrator — 候选生成 + 对抗批评编排（P0-3，2026-09-06）
 *
 * Competitive Strategy Search 轻量版（Teamwork 方案 P0-3 落点），组合既有模块不引新运行时：
 *   1. 候选生成：ParallelAgentScheduler 按 n 个视角并行产出候选方案
 *   2. 对抗批评：VerifierAgent 逐一审查（默认立场 REJECT，需证明正确性；feedback 蒸馏 objection）
 *   3. 收敛：ResultAggregator(BEST_SELECTION) 在通过对抗的候选中选优
 *   4. 失败路线保留：被驳候选的 objection 摘要随结果返回（rejected），不丢弃
 *
 * 成本门控由调用方负责（feature COMPETITIVE_STRATEGY / 显式研究模式）：每轮成本
 * ≈ n 份候选生成 + n 次对抗批评；默认 perspectiveCount=2（成本护栏）。
 * 本类不做开关判定，保持纯编排职责。
 */
import { getLogger } from '@modules/monitoring/logs/Logger.js';
import { handleError } from '@modules/error/handleError.js';
import { ParallelAgentScheduler } from '../agent/moa/ParallelAgentScheduler.js';
import type {
  ScheduledAgentTask,
  ScheduledTaskResult,
} from '../agent/moa/ParallelAgentScheduler.js';
import {
  ResultAggregator,
  AggregationStrategy,
} from '../agent/moa/ResultAggregator.js';
import { VerifierAgent } from './VerifierAgent.js';
import type { VerdictType } from './VerifierAgent.js';

const logger = getLogger('query:competitive');

/** 候选生成/批评共用的轻量 LLM 调用签名（与 VerifierAgent.setCallModel 一致） */
export type ResearchCallModel = (
  messages: Array<{ role: string; content: string }>,
  signal: AbortSignal
) => AsyncGenerator<{ content?: string }>;

/** 编排器配置 */
export interface CompetitiveOrchestratorConfig {
  /** 候选生成与对抗批评共用的 LLM 调用（调用方适配注入；生成时校验 tool 权限由上层负责） */
  callModel: ResearchCallModel;
  /**
   * P3 role 路由（2026-09-07，Teamwork 收尾）：候选生成专用 callModel（generator 角色模型）。
   * 由上层按 modelRouter.resolveRole('generator') 组装注入；未注入回退 cfg.callModel
   * （候选与批评同模型 = 现状路由，验收 #6 默认兼容）。
   */
  generatorCallModel?: ResearchCallModel;
  /** 候选视角数（默认 2；每增加 1 = +1 生成 +1 批评） */
  perspectiveCount?: number;
  /** 候选并发上限（默认 2，勿超 limits.agentConcurrency） */
  maxConcurrency?: number;
  /** 单候选生成超时 ms（默认 120_000） */
  timeoutMs?: number;
  /** 单候选批评超时 ms（默认 60_000） */
  verifyTimeoutMs?: number;
  /**
   * P3 role 路由（2026-09-06，Teamwork）：对抗批评专用 callModel（verifier 角色模型）。
   * 由上层按 modelRouter.resolveRole('verifier') 组装注入；未注入回退 cfg.callModel
   * （候选与批评同模型 = 现状路由，验收 #6 默认兼容）。
   */
  verifierCallModel?: ResearchCallModel;
  /**
   * Teamwork P2b（2026-09-06）：VerifierAgent REJECT → pitfall 记录钩子透传
   * （上层注入 PitfallRegistry.record；未注入 no-op——现状零变化）
   */
  recordPitfall?: (rec: {
    description: string;
    error: string;
    source: 'verifier';
    contextSig?: string;
  }) => void;
}

/** 候选方案（生成产物） */
export interface CandidateProposal {
  agentId: string;
  /** 视角名（如"全局权衡视角"） */
  perspective: string;
  content: string;
  tokensUsed: number;
  durationMs: number;
}

/** 被驳候选与 objection（失败路线保留） */
export interface CandidateObjection {
  agentId: string;
  perspective: string;
  /** 蒸馏出的 objection 摘要列表（默认立场 REJECT 的 feedback 拆分） */
  objections: string[];
  verdict: VerdictType;
  confidence: number;
}

/** 研究编排结果 */
export interface CompetitiveOrchestrationResult {
  /** 收敛最终内容（通过对抗的候选中 BEST_SELECTION；无通过候选则为空串） */
  content: string;
  success: boolean;
  /** 通过对抗批评的候选 */
  approved: CandidateProposal[];
  /** 被驳候选与 objection（供上层注入回复/partialOutput，失败路线不丢） */
  rejected: CandidateObjection[];
  /** 全部候选（按视角序） */
  candidates: CandidateProposal[];
  stats: {
    totalTokens: number;
    totalDurationMs: number;
    candidateCount: number;
    approvedCount: number;
    rejectedCount: number;
  };
}

/** 候选生成视角模板（与 P0-3"不同视角/参数"对齐；数组前缀越多成本越高，perspectiveCount 截取） */
const PERSPECTIVES: Array<{ id: string; name: string; instruction: string }> = [
  {
    id: 'tradeoff',
    name: '全局权衡视角',
    instruction:
      '从整体目标与约束出发提出完整方案。显式列出关键取舍（trade-off）与推荐默认项，输出可直接执行的结论。',
  },
  {
    id: 'adversarial',
    name: '反例攻击视角',
    instruction:
      '先质疑任务前提中的薄弱假设，再给出针对主要风险设计规避措施的方案。优先考虑“什么会让这个方案失败”。',
  },
  {
    id: 'sustainable',
    name: '长期演进视角',
    instruction:
      '从可维护性、成本与后续演进出发提出方案，说明短期收益与长期代价的平衡，避免一次性捷径。',
  },
];

const SYSTEM_GENERATOR =
  '你是多视角候选生成器：针对给定研究任务，从指定视角产出一个自洽、可被他人批评的完整方案。只输出方案正文。';

/**
 * P0-3（2026-09-06）：候选对抗批评的审查准则——注入 VerifierAgent.reviewGuidelines，
 * 替换其默认"代码变更验证"语义为"研究候选方案评审"（修复真机走查 #3：
 * 默认代码维度检查研究方案致通过率异常偏低）。判定机制仍复用 REJECT 默认立场 + checks 通过率。
 */
const REVIEW_GUIDELINES = `审查对象：候选方案/提案（研究评审，非代码变更审查）。
逐项审查以下维度（每项一个 check：item 用维度短标签，passed=是否满足）：
1. 目标回应：是否完整回应研究任务目标，无关键遗漏
2. 可执行性：结论与步骤具体可落地，不含空泛口号或自相矛盾
3. 风险识别：是否识别关键风险/反例并给出应对
4. 权衡合理：成本/复杂度/收益取舍是否合理且有依据
5. 逻辑严谨：无明显逻辑漏洞或边界遗漏

判定：多数维度通过且无致命缺陷 → APPROVE；存在可修复瑕疵 → ESCALATE 并给建议；
存在致命缺陷或大面积不达标 → REJECT 并给具体理由。
注意：默认立场虽为 REJECT，但应据实逐项评判——凡实质满足的维度给 passed:true，
仅在整体存在致命缺陷时才 REJECT；防止无依据的全盘否定。`;

/**
 * 候选生成 + 对抗批评编排器
 */
export class CompetitiveStrategyOrchestrator {
  private cfg: Required<
    Pick<CompetitiveOrchestratorConfig, 'perspectiveCount'>
  > &
    CompetitiveOrchestratorConfig;

  constructor(config: CompetitiveOrchestratorConfig) {
    this.cfg = {
      perspectiveCount: 2,
      ...config,
    };
    if (this.cfg.perspectiveCount < 1) this.cfg.perspectiveCount = 1;
    if (this.cfg.perspectiveCount > PERSPECTIVES.length) {
      this.cfg.perspectiveCount = PERSPECTIVES.length;
    }
  }

  /**
   * 运行候选生成 + 对抗批评 + 收敛
   * @param description 研究任务描述
   * @param signal 中止信号
   */
  async run(
    description: string,
    signal: AbortSignal
  ): Promise<CompetitiveOrchestrationResult> {
    const startTime = Date.now();
    const n = this.cfg.perspectiveCount;
    const perspectives = PERSPECTIVES.slice(0, n);

    // 1. 并行候选生成
    const scheduler = new ParallelAgentScheduler(
      this._buildExecutor(signal),
      this.cfg.timeoutMs ?? 120_000,
      this.cfg.maxConcurrency ?? 2
    );
    const tasks: ScheduledAgentTask[] = perspectives.map((p, i) => ({
      agentId: `candidate_${p.id}`,
      description: `${p.name}（第 ${i + 1}/${n} 份候选）`,
      prompt: `研究任务：${description}\n\n视角要求：${p.instruction}`,
      systemPrompt: SYSTEM_GENERATOR,
    }));
    const scheduleResult = await scheduler.executeAll(tasks);

    const candidates: CandidateProposal[] = scheduleResult.results
      .filter((r) => r.status === 'completed')
      .map((r) => {
        const perspective =
          perspectives.find((p) => `candidate_${p.id}` === r.agentId)?.name ??
          r.description;
        return {
          agentId: r.agentId,
          perspective,
          content: r.content,
          tokensUsed: r.tokensUsed,
          durationMs: r.durationMs,
        } satisfies CandidateProposal;
      });

    if (candidates.length === 0) {
      logger.warn('候选生成全部失败，无可批评对象', {
        taskPreview: description.slice(0, 80),
        failures: scheduleResult.failedCount + scheduleResult.timeoutCount,
      });
      return {
        content: '',
        success: false,
        approved: [],
        rejected: [],
        candidates: [],
        stats: {
          totalTokens: scheduleResult.totalTokens,
          totalDurationMs: Date.now() - startTime,
          candidateCount: 0,
          approvedCount: 0,
          rejectedCount: 0,
        },
      };
    }

    // 2. 逐一对抗批评（每候选独立 VerifierAgent 实例——复用实例会因 maxCycles 触顶）
    const approved: CandidateProposal[] = [];
    const rejected: CandidateObjection[] = [];
    for (const candidate of candidates) {
      const review = await this._critique(description, candidate, signal);
      if (review.passed) {
        approved.push(candidate);
      } else {
        rejected.push({
          agentId: candidate.agentId,
          perspective: candidate.perspective,
          objections: this._distillObjections(review.feedback),
          verdict: review.verdict,
          confidence: review.confidence,
        });
      }
    }

    // 3. 收敛：通过候选 → BEST_SELECTION
    let content = '';
    let success = false;
    if (approved.length > 0) {
      const aggregator = new ResultAggregator({
        strategy: AggregationStrategy.BEST_SELECTION,
        minValidResults: 1,
      });
      const agg = await aggregator.aggregate(
        approved.map((c) => this._toScheduledResult(c))
      );
      content = agg.content;
      success = agg.success;
    }

    logger.info('竞争编排完成', {
      candidateCount: candidates.length,
      approvedCount: approved.length,
      rejectedCount: rejected.length,
      contentLength: content.length,
      totalDurationMs: Date.now() - startTime,
    });

    return {
      content,
      success,
      approved,
      rejected,
      candidates,
      stats: {
        totalTokens: scheduleResult.totalTokens,
        totalDurationMs: Date.now() - startTime,
        candidateCount: candidates.length,
        approvedCount: approved.length,
        rejectedCount: rejected.length,
      },
    };
  }

  /** ParallelAgentScheduler 执行器适配：流式 callModel → 完整 content */
  private _buildExecutor(signal: AbortSignal): {
    execute: (
      task: ScheduledAgentTask
    ) => Promise<{ content: string; tokensUsed: number }>;
  } {
    return {
      execute: async (task: ScheduledAgentTask) => {
        const messages: Array<{ role: string; content: string }> = [];
        if (task.systemPrompt)
          messages.push({ role: 'system', content: task.systemPrompt });
        messages.push({ role: 'user', content: task.prompt });
        const chunks: string[] = [];
        // P3 role 路由：候选生成用 generator 角色模型 callModel（未注入回退现状 callModel）
        for await (const chunk of this.cfg.generatorCallModel?.(
          messages,
          signal
        ) ?? this.cfg.callModel(messages, signal)) {
          if (chunk.content) chunks.push(chunk.content);
        }
        const content = chunks.join('');
        // tokensUsed 近似：无 tokenizer 场景用字符量估（与 MoA 侧既有降级口径一致，仅统计用）
        const tokensUsed = Math.ceil(content.length / 4);
        if (!content.trim())
          throw new Error('candidate generation returned empty');
        return { content, tokensUsed };
      },
    };
  }

  /** 对抗批评：把候选作为"待审工具产出"喂 VerifierAgent（默认立场 REJECT） */
  private async _critique(
    description: string,
    candidate: CandidateProposal,
    signal: AbortSignal
  ): Promise<{
    passed: boolean;
    verdict: VerdictType;
    confidence: number;
    feedback?: string;
  }> {
    const verifier = new VerifierAgent({
      enabled: true,
      maxCycles: 1,
      confidenceThreshold: 0.7,
      timeoutMs: this.cfg.verifyTimeoutMs ?? 60_000,
      // Teamwork P2b：REJECT 批评 → pitfall 写点（P1-2 注册表）
      recordPitfall: this.cfg.recordPitfall,
    });
    // P3 role 路由：批评用 verifier 角色模型 callModel（未注入回退生成 callModel）
    verifier.setCallModel(this.cfg.verifierCallModel ?? this.cfg.callModel);
    try {
      const result = await verifier.verify(
        {
          messages: [
            {
              role: 'user',
              content: `研究任务：${description}\n\n请对下方候选提案执行对抗审查。`,
            },
          ],
          toolResults: [
            {
              toolName: 'candidate_proposal',
              toolCallId: candidate.agentId,
              result: candidate.content.slice(0, 3000),
            },
          ],
          turnCount: 0,
          sessionId: 'competitive',
          // P0-3：注入研究候选评审准则，避免默认"代码变更验证"语义错位（真机走查 #3）
          reviewGuidelines: REVIEW_GUIDELINES,
        },
        signal
      );
      return {
        // P0-3（2026-09-06 走查 #3）：VerifierAgent 的代码审查通过规则（passRate≥0.8 才
        // APPROVE，0.5-0.8 高置信反被 REJECT）对研究文本评审过苛——编排层改用"半数维度
        // 认可即进入收敛池"的研究评审语义（ESCALATE=低置信仍保守拒绝；REJECT 但多数维度
        // 认可视为有条件通过，objection 仍随 rejected 供参考）
        passed:
          result.verdict === 'APPROVE' ||
          (result.verdict !== 'ESCALATE' && (result.checkPassRate ?? 0) >= 0.5),
        verdict: result.verdict,
        confidence: result.confidence,
        feedback: result.feedback,
      };
    } catch (err) {
      await handleError(err, {
        module: 'query:competitive',
        action: 'critique',
        context: { agentId: candidate.agentId },
      });
      // 批评自身失败 → 不误杀候选（降级通过），objection 留空
      return { passed: true, verdict: 'APPROVE', confidence: 0.1 };
    }
  }

  /** feedback 字符串 → objection 列表（按换行/编号/分隔符蒸馏，去空去重） */
  private _distillObjections(feedback?: string): string[] {
    if (!feedback) return [];
    const parts = feedback
      .split(/\n|·|•|\d+[.、）)]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return Array.from(new Set(parts)).slice(0, 5);
  }

  private _toScheduledResult(c: CandidateProposal): ScheduledTaskResult {
    return {
      agentId: c.agentId,
      description: c.perspective,
      content: c.content,
      success: true,
      durationMs: c.durationMs,
      tokensUsed: c.tokensUsed,
      status: 'completed',
    };
  }
}
