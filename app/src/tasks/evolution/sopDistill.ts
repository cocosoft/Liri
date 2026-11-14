// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * SOP 蒸馏（D10，2026-11-14）
 *
 * 成功轨迹（**已完成的 PDCA 计划**）→ **确定性** SOP 草案（Markdown）。
 *
 * 三条硬约束：
 * 1. **不调 LLM**：同一轨迹必得同一草案（验收「草案生成可复现」），且不臆造轨迹外内容（CS04）；
 * 2. **只产草案**：本模块不写技能、不注册任何东西（注册必须人工确认，见 `SopDraftStore.installSkill`）；
 * 3. **只用轨迹事实**：步骤描述 / 产物台账 / 重试次数 / 验收标准，全部来自 `Plan`，缺失即不写。
 *
 * 判定与 IO 分离（R06-006 GR03）：本文件为纯函数，计划文件读取见 `sopPlanSource.ts`。
 */

import { createHash } from 'crypto';

/** 一条成功步骤（**只保留蒸馏所需字段**；由调用方从已完成计划投影） */
export interface SopTrajectoryStep {
  description: string;
  /** 该步重试次数（0 ⇒ 一次通过，不写入草案） */
  retryCount: number;
  /** 真实产物路径台账（缺省 ⇒ 未采集，不写入草案） */
  artifacts?: string[];
  /** 验收标准（有则汇总到「验收要点」） */
  acceptanceCriteria?: string;
}

/** 一条成功轨迹（计划级） */
export interface SopTrajectory {
  planId: string;
  /** 计划描述（即"目标"） */
  goalText: string;
  /** 计划完成时间（ISO，可选） */
  completedAt?: string;
  steps: SopTrajectoryStep[];
}

/** 蒸馏产物（**未落盘**的草案内容） */
export interface SopDraftContent {
  /** 内容哈希（同轨迹 ⇒ 同 id；重新蒸馏不会产生重复草案） */
  id: string;
  title: string;
  planId: string;
  markdown: string;
}

/** 标题最大长度（超出截断，避免草案文件名/技能描述过长） */
export const SOP_TITLE_MAX = 60;

/** 压成单行（轨迹描述可能含换行，写进 Markdown 标题/列表会破坏结构） */
function singleLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** 草案标题（空 ⇒ 空串，由调用方回退到 planId） */
export function sopTitle(goalText: string): string {
  const line = singleLine(goalText);
  return line.length > SOP_TITLE_MAX
    ? `${line.slice(0, SOP_TITLE_MAX)}…`
    : line;
}

/** 生成 SOP 草案正文（**纯函数**：输入相同 ⇒ 输出逐字相同） */
export function buildSopMarkdown(trajectory: SopTrajectory): string {
  const title = sopTitle(trajectory.goalText) || trajectory.planId;
  const lines: string[] = [
    `# SOP：${title}`,
    '',
    `> 由成功轨迹蒸馏（plan \`${trajectory.planId}\`${
      trajectory.completedAt ? `，完成于 ${trajectory.completedAt}` : ''
    }）。**草案未注册**，需人工确认后才写入技能。`,
    '',
    '## 适用场景',
    '',
    singleLine(trajectory.goalText) || '（轨迹未记录目标描述）',
    '',
    '## 步骤',
    '',
  ];

  trajectory.steps.forEach((step, i) => {
    lines.push(`${i + 1}. ${singleLine(step.description)}`);
    if (step.artifacts && step.artifacts.length > 0) {
      const list = step.artifacts.map((a) => `\`${a}\``).join('、');
      lines.push(`   - 产物：${list}`);
    }
    if (step.retryCount > 0) {
      lines.push(`   - 纠偏：重试 ${step.retryCount} 次后通过`);
    }
  });

  const criteria = trajectory.steps
    .map((s) => (s.acceptanceCriteria ? singleLine(s.acceptanceCriteria) : ''))
    .filter((c) => c.length > 0);
  if (criteria.length > 0) {
    lines.push('', '## 验收要点', '');
    for (const c of criteria) lines.push(`- ${c}`);
  }

  lines.push(
    '',
    '## 来源',
    '',
    `- planId：\`${trajectory.planId}\``,
    `- 步骤数：${trajectory.steps.length}`
  );
  return `${lines.join('\n')}\n`;
}

/** 草案 id = 正文内容哈希（截 12 位；同内容 ⇒ 同 id ⇒ 幂等） */
export function computeSopDraftId(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex').slice(0, 12);
}

/** 单条轨迹 → 草案内容（纯函数） */
export function buildSopDraft(trajectory: SopTrajectory): SopDraftContent {
  const markdown = buildSopMarkdown(trajectory);
  return {
    id: computeSopDraftId(markdown),
    title: sopTitle(trajectory.goalText) || trajectory.planId,
    planId: trajectory.planId,
    markdown,
  };
}

/**
 * 批量蒸馏（纯函数）：**按入参顺序**产出，同内容去重，最多 `limit` 条。
 *
 * 空步骤轨迹跳过（无可蒸馏内容）；去重语义 = 同内容只保留第一条。
 */
export function distillSopDrafts(
  trajectories: readonly SopTrajectory[],
  limit = 10
): SopDraftContent[] {
  const out: SopDraftContent[] = [];
  const seen = new Set<string>();
  for (const trajectory of trajectories) {
    if (trajectory.steps.length === 0) continue;
    const draft = buildSopDraft(trajectory);
    if (seen.has(draft.id)) continue;
    seen.add(draft.id);
    out.push(draft);
    if (out.length >= limit) break;
  }
  return out;
}
