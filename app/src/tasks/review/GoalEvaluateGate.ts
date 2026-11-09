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

import { existsSync, lstatSync, readFileSync } from 'fs';
import { extname, join } from 'path';
import { configManager } from '@openliri/infra/config';
import { getLogger } from '@openliri/infra/monitoring';
import { toWorkspaceRelativePath, type AgentIsolation } from '@modules/agent';
import type { ExecutorFn } from '../lro/contracts.js';
import { normalizeExecutorResult } from '../lro/contracts.js';

const logger = getLogger('tasks:goalEvaluateGate');

/**
 * 副模型执行器（与 ReviewGate 同构：只读调用）。
 *
 * 2026-10-08：原为**重复声明**的一份形状（`tools: string[]` + `Promise<string>`），
 * 现收敛为 `ExecutorFn` 别名（单一事实源 `tasks/lro/contracts.ts`）。
 */
export type GoalEvaluateExecutor = ExecutorFn;

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
    /** 本步产物路径台账（LRO-12）：评估时回读最终产物内容作为取证 */
    artifacts?: string[];
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

/** 单步执行结果投入评估的字符上限（防止把整段执行记录撑爆评估 prompt） */
const STEP_RESULT_MAX_CHARS = 4000;
/** 产物取证：单个文件读取上限 */
const EVIDENCE_FILE_MAX_BYTES = 512 * 1024;
const EVIDENCE_FILE_MAX_CHARS = 6000;
/** 产物取证：单次评估的总字符 / 文件数上限 */
const EVIDENCE_TOTAL_MAX_CHARS = 20_000;
const EVIDENCE_MAX_FILES = 40;

/** 只回读这些扩展名的产物（其余视为二进制/不可读，不投入评估） */
const EVIDENCE_TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.json',
  '.yaml',
  '.yml',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.py',
  '.sh',
  '.ps1',
  '.bat',
  '.csv',
  '.xml',
  '.toml',
  '.ini',
  '.log',
]);

/** P1-3：是否启用目标级收敛判定（PDCA_GOAL_EVALUATE，默认启用） */
export function isGoalEvaluateEnabled(): boolean {
  return configManager.env('PDCA_GOAL_EVALUATE') !== 'false';
}

/** 截断文本并显式标注（避免模型把"截断"误读成"内容缺失"） */
function truncateText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}\n…（已截断 ${trimmed.length - max} 字符）`;
}

/**
 * 回读**产物台账**里的文本文件内容，作为目标级评估的取证。
 *
 * 2026-11-09（真机 `pdca_mw8nknox`）：原评估输入只有步骤摘要 + 审查文本 ⇒
 * 第 4 步审查留下的陈旧缺陷（"game.js 用 getElementById('game')"）在第 5 步已修复，
 * 但评估模型看不到最终产物 ⇒ 以陈旧文本判 `converged=false` ⇒ 假失败 + 全量 replan。
 * 这里按产物路径回读**最终内容**，让"缺陷是否仍存在"可被直接核对。
 *
 * 工作区不存在 / 路径不可归属 / 文件不可读 ⇒ 跳过（不阻断评估）。
 */
export function collectArtifactEvidence(
  workspace: string | undefined,
  artifacts: ReadonlyArray<string>
): string {
  if (!workspace || artifacts.length === 0 || !existsSync(workspace)) return '';
  const unique = [...new Set(artifacts.map((a) => a.trim()).filter(Boolean))];
  const chunks: string[] = [];
  let used = 0;
  for (const artifact of unique.slice(0, EVIDENCE_MAX_FILES)) {
    const rel = toWorkspaceRelativePath(workspace, artifact);
    if (!rel) continue;
    if (!EVIDENCE_TEXT_EXTENSIONS.has(extname(rel).toLowerCase())) continue;
    const full = join(workspace, rel);
    try {
      const st = lstatSync(full);
      if (!st.isFile() || st.size > EVIDENCE_FILE_MAX_BYTES) continue;
      const chunk = `### ${rel}\n${truncateText(
        readFileSync(full, 'utf-8'),
        EVIDENCE_FILE_MAX_CHARS
      )}`;
      if (used + chunk.length > EVIDENCE_TOTAL_MAX_CHARS) break;
      chunks.push(chunk);
      used += chunk.length;
    } catch {
      // @ignore-catch — 取证属附加信息，单个文件读失败不得阻断评估
      continue;
    }
  }
  return chunks.join('\n\n');
}

/** 组装目标级评估 prompt（步骤完成情况 + 最终产物取证） */
function buildGoalEvaluatePrompt(
  input: GoalEvaluateInput,
  evidence: string
): string {
  const stepsSummary = input.steps
    .map((s) => {
      const lines = [`- [${s.status}] ${s.description}`];
      if (s.result?.trim()) {
        lines.push(
          `  最终执行结果: ${truncateText(s.result, STEP_RESULT_MAX_CHARS)}`
        );
      }
      if (s.artifacts && s.artifacts.length > 0) {
        lines.push(`  产物: ${s.artifacts.join(', ')}`);
      }
      if (s.review?.trim()) {
        lines.push(`  当轮审查（历史快照，可能已被后续步骤修复）: ${s.review}`);
      }
      return lines.join('\n');
    })
    .join('\n');

  return [
    `评估以下任务目标是否已真正达成（基于步骤最终执行结果与最终产物取证）。`,
    `目标: ${input.goal}`,
    `步骤执行摘要:\n${stepsSummary}`,
    evidence ? `最终产物证据（评估前回读的工作区文件内容）:\n${evidence}` : '',
    `判定要点：`,
    `1. 所有步骤虽已标记完成，但最终结果/产物是否真正实现目标？`,
    `2. 是否存在"步骤全过但目标未实现"的假完成？`,
    `判定口径（硬约束）：`,
    `- 「当轮审查」是那一轮的历史快照，**可能已被后续步骤修复**；不得仅凭历史审查文本判定未收敛。`,
    `- 以「最终执行结果」与「最终产物证据」为准：缺陷在最终产物中已不存在 ⇒ 视为已修复。`,
    `- 只有最终证据仍能确认缺陷存在时，才输出 converged=false，并在 reason 中引用具体证据。`,
    `- 证据不足以判断时输出 converged=null（跳过结论），不要猜测。`,
    `请输出 JSON: {"converged":true|false|null,"confidence":0-1,"reason":"简要说明"}`,
  ]
    .filter(Boolean)
    .join('\n');
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
    // 取证闭环（2026-11-09）：回读各步产物台账的**最终内容**，让"缺陷是否仍存在"可核对；
    // 而不是只让评估模型看那一轮的历史审查文本。
    const evidence = collectArtifactEvidence(
      ctx.isolation?.workspace,
      input.steps.flatMap((s) => s.artifacts ?? [])
    );
    const prompt = buildGoalEvaluatePrompt(input, evidence);
    try {
      const raced = await Promise.race([
        ctx.executor({
          systemPrompt:
            '你是一个目标收敛评估器。基于步骤最终执行结果与最终产物证据判断任务目标是否真正达成。只读操作，不修改任何文件。' +
            '历史审查文本可能已被后续步骤修复，不得据此判定未收敛。' +
            '证据不足时输出 converged=null（跳过结论）。' +
            '输出 JSON 格式：{"converged":true|false|null,"confidence":0-1,"reason":"简要说明"}',
          userPrompt: prompt,
          // 纯文本 JSON 评估角色：原 `['search', 'file']` 是**类别名误当工具名**（永不命中）
          // ⇒ 实际即 0 工具；此处如实写 0。
          tools: [],
          taskType: 'chat',
          isolation: ctx.isolation,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('goal_evaluate_timeout')),
            EVALUATE_TIMEOUT_MS
          )
        ),
      ]);
      return parseEvaluateResult(normalizeExecutorResult(raced).content);
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
