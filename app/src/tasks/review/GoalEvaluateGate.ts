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
 * 降级：副模型调用失败 / 解析失败 → converged=true（保守放行，不阻塞主流程；
 *       目标是"确认"而非"阻断"，失败时维持既有完成语义）。
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
  /** 目标是否已达成（true=收敛可完成；false=未达成需继续/介入） */
  converged: boolean;
  /** 模型置信度（0-1；降级路径为 0） */
  confidence: number;
  /** 收敛/未收敛原因说明 */
  reason: string;
  /** 评估是否真实执行（false = 降级放行） */
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

/** 解析副模型输出（JSON.parse + 容错：converged 缺省视为 true 放行） */
function parseEvaluateResult(text: string): GoalEvaluateResult {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return {
      converged: true,
      confidence: 0,
      reason: '评估输出非 JSON，降级放行',
      evaluated: true,
    };
  }
  try {
    const parsed = JSON.parse(match[0]) as {
      converged?: boolean;
      confidence?: number;
      reason?: string;
    };
    return {
      converged: parsed.converged !== false,
      confidence: Number(parsed.confidence) || 0,
      reason: parsed.reason || '(无说明)',
      evaluated: true,
    };
  } catch {
    return {
      converged: true,
      confidence: 0,
      reason: '评估输出解析失败，降级放行',
      evaluated: true,
    };
  }
}

/**
 * 目标级收敛判定门（无状态，可复用单例）
 */
export class GoalEvaluateGate {
  /**
   * 执行目标级评估。
   * 副模型调用失败 / 超时 → 降级放行（converged=true），不阻断主流程。
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
      logger.warn('目标级评估失败，降级放行（不阻塞主流程）', {
        error: String(err),
      });
      return {
        converged: true,
        confidence: 0,
        reason: '评估失败，降级放行',
        evaluated: false,
      };
    }
  }
}
