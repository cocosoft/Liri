// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * plannerSupport —— 计划生成/修复与步骤拓扑（LRO 拆分批 U-22/S1）
 *
 * **来源**：从 `LongRunningTaskOrchestrator.ts` 外移 `roleToolNames`（模块级）/
 * `_groupStepsByDependency` / `_repairPlanJson` / `_repairAcceptanceCriteria`。
 *
 * **职责（单一：把 planner 输出变成可执行计划）**：
 *   ① 角色工具名派生（按 `RoleConfig.taskType` 从 TOOL_CATEGORIES 取，禁止手写清单）；
 *   ② `dependsOn` 拓扑批次分组（循环依赖兜底串行）；
 *   ③ 计划 JSON 修复重问（一次）与验收标准纠正（一次）。
 *
 * **行为等价**：提示词文案、日志字段、失败返回 `undefined` 的语义**逐字未变**。
 */

import { handleError } from '@modules/error';
import { getLogger } from '@modules/monitoring';

import { getRealToolNamesForTask } from '../../tools/index.js';
import { parsePlanDraft, type PlanDraft } from '../planOutputParser';
import type { PlanStep } from '../TaskOrchestrator';
import {
  normalizeExecutorResult,
  PLANNER_ROLE,
  type ExecutorFn,
  type RoleConfig,
} from './contracts.js';

const logger = getLogger('tasks:longRunning');

/**
 * 角色可用工具名：由角色的**任务类型**经 `TOOL_CATEGORIES` 派生（单一事实源）。
 *
 * 2026-10-08：禁止手写工具名清单 —— 原 `RoleConfig.toolsets`（hermes 名）展开后 19/23
 * 永不命中 ⇒ 步骤 0 工具可用（事故指纹：73 步 / 0 次工具调用）。
 */
export function roleToolNames(role: RoleConfig): string[] {
  return role.useTools ? getRealToolNamesForTask(role.taskType) : [];
}

/**
 * D2（M3，2026-08-13）：按 step.dependsOn 做拓扑批次分组。
 * 无 dependsOn 的步骤视为相互独立（可并行）；有 dependsOn 的步骤延迟到依赖批次之后。
 * 当前 PDCA 流程未填充 dependsOn → 单批次（全部独立）；依赖模型启用后自动生效。
 * 死锁/循环依赖兜底：整批剩余步骤串行执行（不阻塞主流程）。
 */
export function groupStepsByDependency(steps: PlanStep[]): PlanStep[][] {
  const remaining = new Map(steps.map((s) => [s.id, s]));
  const batches: PlanStep[][] = [];

  while (remaining.size > 0) {
    const ready: PlanStep[] = [];
    for (const step of remaining.values()) {
      const deps = step.dependsOn ?? [];
      // 依赖不在剩余集合 = 已执行完成或属于更早批次
      if (deps.every((d) => !remaining.has(d))) ready.push(step);
    }
    if (ready.length === 0) {
      // 循环依赖或残留依赖缺失：兜底按剩余顺序串行执行
      batches.push([...remaining.values()]);
      remaining.clear();
      break;
    }
    for (const s of ready) remaining.delete(s.id);
    batches.push(ready);
  }
  return batches;
}

export interface PlannerRepairDeps {
  taskId: string;
  executor: ExecutorFn;
  isolation: Parameters<ExecutorFn>[0]['isolation'];
}

/**
 * U-01（2026-10-17）：Planner 输出修复重问（只做一次）。
 *
 * 与 `repairAcceptanceCriteria` 同模式：把不可解析的原始输出回灌，要求**仅输出 JSON**。
 * 返回 `undefined` 表示修复不可用 —— 调用方据此整体失败（不再行切兜底）。
 */
export async function repairPlanJson(
  deps: PlannerRepairDeps,
  description: string,
  originalOutput: string,
  reason: string
): Promise<PlanDraft | undefined> {
  const prompt = [
    '你先前输出的执行计划无法被 JSON 解析。请**只输出修正后的 JSON**（不要围栏、不要解释、不要前后缀）。',
    '',
    `任务描述: ${description}`,
    `解析失败原因: ${reason}`,
    '',
    '【原始输出（可能被截断）】',
    originalOutput.slice(0, 6000),
    '',
    '【输出格式】',
    '{"steps": ["步骤1描述", "步骤2描述"], "acceptanceCriteria": ["步骤1验收", "步骤2验收"], "dependsOn": [[], [0]]}',
    'steps 必须是非空字符串数组（1–10 条）；acceptanceCriteria 条数须与 steps 一致；',
    'dependsOn 可选，只允许引用更早步骤的下标（0-based）。',
  ].join('\n');

  try {
    const text = normalizeExecutorResult(
      await deps.executor({
        systemPrompt: PLANNER_ROLE.systemPrompt,
        userPrompt: prompt,
        tools: roleToolNames(PLANNER_ROLE),
        taskType: PLANNER_ROLE.taskType,
        isolation: deps.isolation,
      })
    ).content;
    const parsed = parsePlanDraft(text);
    if (!parsed.ok) {
      logger.warn('[orchestrator] Planner JSON 修复重问仍不可解析', {
        taskId: deps.taskId,
        reason: parsed.reason,
      });
      return undefined;
    }
    logger.info('[orchestrator] Planner JSON 修复重问成功', {
      taskId: deps.taskId,
      steps: parsed.draft.steps.length,
    });
    return parsed.draft;
  } catch (e) {
    await handleError(e, {
      module: 'tasks:longRunning',
      action: 'repairPlanJson',
    });
    return undefined;
  }
}

/**
 * 验收标准**一次纠正**（2026-10-08，方案1 全面修复）：
 * 要求 planner **只重写 `acceptanceCriteria`**（步骤描述与顺序不变、条数对齐），
 * 使每条都落在"工具输出可直接证明"的范围内。
 *
 * 返回 `undefined` 表示纠正不可用（解析失败/条数不齐/调用异常）—— 调用方**保留原验收标准**
 * （绝不因纠正失败而丢条件）。
 */
export async function repairAcceptanceCriteria(
  deps: PlannerRepairDeps,
  description: string,
  steps: readonly string[],
  offending: readonly string[]
): Promise<string[] | undefined> {
  const stepList = steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const prompt = [
    '你先前给出的验收标准中，下列条目**无法用工具输出证明**，请**只重写验收标准**（步骤描述与顺序保持不变）。',
    '',
    `任务描述: ${description}`,
    '',
    `步骤（共 ${steps.length} 步，顺序不变）:`,
    stepList,
    '',
    '【不合格条目】',
    ...offending.map((s) => `- ${s}`),
    '',
    '【硬性要求】每条验收标准执行完后，用**一次**工具调用的输出即可直接判定真假。',
    '✅ 正例：`file_read 读取 <路径> 返回内容等于 <值>`；`glob 在 <目录> 下能列出 <文件名>`；',
    '`grep 在 <文件> 中命中 <文本>`。',
    '❌ 禁止：字节级/编码级（严格 N 字节、无 BOM、无多余换行/空格、校验和/哈希）；',
    '**以 shell（bash/powershell）作为判定动作**（shell 受安全策略门控，可能被硬拒）；',
    '指定"必须调用某具体工具"；需文件系统元数据（权限位/时间戳/磁盘空间）；"可写性（需显式写入测试）"；"执行前后对比"。',
    '若某点无法被证明，改写成**可观察的近似条件**（如"内容等于 X"），不要叠加不可证修饰。',
    '',
    `只输出 JSON（不要其他内容），且必须恰好 ${steps.length} 条、与步骤一一对应：`,
    '{"acceptanceCriteria": ["第1步的验收标准", "第2步的验收标准"]}',
  ].join('\n');

  try {
    const text = normalizeExecutorResult(
      await deps.executor({
        systemPrompt: PLANNER_ROLE.systemPrompt,
        userPrompt: prompt,
        tools: roleToolNames(PLANNER_ROLE),
        taskType: PLANNER_ROLE.taskType,
        isolation: deps.isolation,
      })
    ).content;
    const parsed = JSON.parse(text) as { acceptanceCriteria?: unknown };
    const next = Array.isArray(parsed?.acceptanceCriteria)
      ? parsed.acceptanceCriteria.map((s) => String(s))
      : undefined;
    if (!next || next.length !== steps.length) {
      logger.warn(
        '[orchestrator] 验收标准纠正结果不可用（条数不齐/解析失败）',
        {
          taskId: deps.taskId,
          expected: steps.length,
          got: next?.length ?? -1,
        }
      );
      return undefined;
    }
    return next;
  } catch (e) {
    await handleError(e, {
      module: 'tasks:longRunning',
      action: 'repairAcceptanceCriteria',
    });
    return undefined;
  }
}
