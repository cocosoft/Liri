// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P1（2026-11-10）：**阶段交付物**的结构化投影（纯函数，无 IO）。
 *
 * 背景（真机 `pdca_mw9g2qzz`）：阶段之间只传 `collectStageArtifact` 拼出的
 * "步骤描述 + 结果" ⇒ 下一阶段 planner 把"上一阶段的**指令**"当成待办，
 * 重复创建同一产物（requirement 写过 `prd.md`，design 又写一遍），
 * 并把校验拆成独立步骤反复读写。
 *
 * 本模块把阶段成果投影为「目标 / 验收标准 / 产物台账 / 已成立事实」四元组，
 * 供下一阶段以"**已成立事实，禁止重复创建**"消费。
 * **刻意不包含步骤描述** —— 指令（要做什么）不是事实（已经是什么）。
 */

import { STEP_STATUS_COMPLETED } from './TaskOrchestrator.js';

/** 投影所需的步骤字段（与 `PlanStep` 的结构子集，便于纯函数直测） */
export interface DeliverableStepInput {
  status?: string;
  result?: string;
  artifacts?: ReadonlyArray<string>;
  acceptanceCriteria?: string;
}

export interface StageDeliverable {
  /** 阶段目标（计划描述，非步骤描述） */
  goal: string;
  /** 结构化验收标准（保序去重） */
  criteria: string[];
  /** 产物台账（工作区相对路径，保序去重） */
  artifacts: string[];
  /** 已成立事实（已完成步骤的结果摘要） */
  facts: string[];
}

/** 单条事实的最大字符数（防超长正文把下一阶段 prompt 吃满） */
const MAX_FACT_CHARS = 200;

/**
 * 步骤快照 ⇒ 阶段交付物。
 *
 * 只取**已完成**步骤的 `result` 作为事实：非完成步骤的中间输出不是"已成立"。
 */
export function projectStageDeliverable(input: {
  goal?: string;
  steps: ReadonlyArray<DeliverableStepInput>;
}): StageDeliverable {
  const criteria: string[] = [];
  const artifacts: string[] = [];
  const facts: string[] = [];

  for (const step of input.steps) {
    const criterion = (step.acceptanceCriteria ?? '').trim();
    if (criterion && !criteria.includes(criterion)) criteria.push(criterion);

    for (const artifact of step.artifacts ?? []) {
      const path = artifact.trim();
      if (path && !artifacts.includes(path)) artifacts.push(path);
    }

    if (step.status === STEP_STATUS_COMPLETED) {
      const result = (step.result ?? '').trim();
      if (result) {
        facts.push(
          result.length > MAX_FACT_CHARS
            ? `${result.slice(0, MAX_FACT_CHARS)}…`
            : result
        );
      }
    }
  }

  return {
    goal: (input.goal ?? '').trim(),
    criteria,
    artifacts,
    facts,
  };
}

/** 交付物的**提示词投影**（下一阶段消费；标题即契约：禁止重复创建） */
export function formatStageDeliverable(deliverable: StageDeliverable): string {
  const lines: string[] = ['【已成立事实（禁止重复创建/重新实现）】'];
  if (deliverable.goal) lines.push(`- 目标：${deliverable.goal}`);
  if (deliverable.artifacts.length > 0) {
    lines.push(`- 产物（已存在）：${deliverable.artifacts.join('、')}`);
  }
  if (deliverable.criteria.length > 0) {
    lines.push('- 验收标准：');
    for (const criterion of deliverable.criteria) {
      lines.push(`  - ${criterion}`);
    }
  }
  if (deliverable.facts.length > 0) {
    lines.push('- 事实：');
    for (const fact of deliverable.facts) lines.push(`  - ${fact}`);
  }
  return lines.join('\n');
}
