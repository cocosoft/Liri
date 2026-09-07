// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * GoalEvaluateGate — 目标级收敛判定（P1-3，对标 Hermes goals.py evaluate_after_turn）
 *
 * 步骤级 ReviewGate 只验证"单步验收标准是否达标"；本组件在 PDCA 步骤全部达到
 * 终态后，用副模型评估"整体目标是否真正达成"，防止"步骤全过但目标未实现"的
 * 假完成（Hermes GoalContract outcome/stop_when 语义）。
 *
 * 开关：环境变量 PDCA_GOAL_EVALUATE（默认 'true' 启用，'false' 关闭）。
 * 三态（L7，2026-09-06）：converged 为 true | false | undefined（未决）。
 * 副模型调用失败 / 超时 / 输出非 JSON / 未给出明确 bool → converged=undefined 且
 * evaluated=false（"跳过结论"，不误报达成）；仅模型明确 true 才算收敛。
 */

import { configManager } from '@modules/config';
import { getLogger } from '@modules/monitoring';
import type { AgentIsolation } from '@modules/agent';

const logger = getLogger('tasks:goalEvaluateGate');

/** 副模型执行器（与 ReviewGate 同构：只读调用） */
export interface GoalEvaluateExecutor {
  (params: {
    systemPrompt: string;
    userPrompt: string;
    tools: string[];
    isolation: AgentIsolation;
  }): Promise<string>;
}

/** 目标级评估上下文（Orchestrator 注入运行时依赖） */
export interface GoalEvaluateContext {
  isolation: AgentIsolation;
  executor: GoalEvaluateExecutor;
}

/** 目标级评估输入（步骤终态摘要） */
export interface GoalEvaluateInput {
  /** 整体目标描述（plan.description） */
  goal: string;
  steps: Array<{
    description: string;
    status: string;
    result?: string;
    review?: string;
  }>;
}

/** 目标级评估结果 */
export interface GoalEvaluateResult {
  /**
   * 目标是否已达成（L7 三态：true=明确收敛；false=明确未达成；undefined=未决/降级跳过）。
   * 上层消费规则：仅 converged===true 视为"已确认达成"；===false 阻止假完成；undefined 跳过结论。
   */
  converged: boolean | undefined;
  /** 模型置信度（0-1；未决/降级路径为 0） */
  confidence: number;
  /** 收敛/未收敛/未决原因说明 */
  reason: string;
  /** 评估是否真实执行并给出可信结论（false = 降级/未决，上层跳过结论） */
  evaluated: boolean;
}

/** 评估超时保护（对齐 ReviewGate verifyProject 的 30s 上限） */
const EVALUATE_TIMEOUT_MS = 30_000;

/** P1-3：是否启用目标级收敛判定（PDCA_GOAL_EVALUATE，默认启用） */
export function isGoalEvaluateEnabled(): boolean {
  return configManager.env('PDCA_GOAL_EVALUATE') !== 'false';
}

/** 组装目标级评估 prompt（步骤完成情况作为上下文） */
function buildGoalEvaluatePrompt(input: GoalEvaluateInput): string {
  const stepsSummary = input.steps
    .map(
      (s) =>
        `- [${s.status}] ${s.description}${s.review ? `（审查: ${s.review}）` : ''}`
    )
    .join('\n');

  return [
    `评估以下任务目标是否已真正达成（基于执行步骤的完成情况与审查结论）。`,
    `目标: ${input.goal}`,
    `步骤执行摘要:\n${stepsSummary}`,
    `判定要点：`,
    `1. 所有步骤虽已标记完成，但执行结果是否真正实现目标？`,
    `2. 是否存在"步骤全过但目标未实现"的假完成？`,
    `请输出 JSON: {"converged":bool,"confidence":0-1,"reason":"简要说明"}`,
  ].join('\n');
}

/** 解析副模型输出（L7 三态：非 JSON / 解析失败 / 未给明确 bool → converged=undefined 跳过结论，
 *  不再默认视为 true 放行——原实现把解析失败当"达成"可能放行假完成） */
function parseEvaluateResult(text: string): GoalEvaluateResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      converged: undefined,
      confidence: 0,
      reason: '评估输出非 JSON，跳过结论',
      evaluated: false,
    };
  }
  try {
    const parsed = JSON.parse(match[0]) as {
      converged?: boolean;
      confidence?: number;
      reason?: string;
    };
    // 仅模型明确输出 true/false 才算可信结论；缺省/非 bool → 未决（跳过）
    if (parsed.converged !== true && parsed.converged !== false) {
      return {
        converged: undefined,
        confidence: Number(parsed.confidence) || 0,
        reason: parsed.reason || '评估未给出明确收敛结论，跳过',
        evaluated: false,
      };
    }
    return {
      converged: parsed.converged,
      confidence: Number(parsed.confidence) || 0,
      reason: parsed.reason || '(无说明)',
      evaluated: true,
    };
  } catch {
    return {
      converged: undefined,
      confidence: 0,
      reason: '评估输出解析失败，跳过结论',
      evaluated: false,
    };
  }
}

/**
 * 目标级收敛判定门（无状态，可复用单例）
 */
export class GoalEvaluateGate {
  /**
   * 执行目标级评估。
   * 副模型调用失败 / 超时 → converged=undefined + evaluated=false（跳过结论），
   * 不阻塞主流程也不误报"达成"（L7 三态；原实现降级放行 converged=true 可能放行假完成）。
   */
  async evaluate(
    input: GoalEvaluateInput,
    ctx: GoalEvaluateContext
  ): Promise<GoalEvaluateResult> {
    const prompt = buildGoalEvaluatePrompt(input);
    try {
      const text = await Promise.race([
        ctx.executor({
          systemPrompt:
            '你是一个目标收敛评估器。基于步骤执行摘要判断任务目标是否真正达成。只读操作，不修改任何文件。输出 JSON 格式：{"converged":bool,"confidence":0-1,"reason":"简要说明"}',
          userPrompt: prompt,
          tools: ['search', 'file'],
          isolation: ctx.isolation,
        }),
        new Promise<string>((_, reject) =>
          setTimeout(
            () => reject(new Error('goal_evaluate_timeout')),
            EVALUATE_TIMEOUT_MS
          )
        ),
      ]);
      return parseEvaluateResult(text);
    } catch (err) {
      logger.warn('目标级评估失败，跳过结论（不阻塞主流程）', {
        error: String(err),
      });
      return {
        converged: undefined,
        confidence: 0,
        reason: '评估失败，跳过结论',
        evaluated: false,
      };
    }
  }
}
