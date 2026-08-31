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
 * DreamPlanContract — 自主运行计划契约（D1-Step2，对标 PilotDeck PlanContract）
 *
 * 严格 markdown 计划格式：
 *   # 标题
 *   > 元数据块（首行必须为 Dream Plan，含 id/projectRoot/createdAt/dedupeKey）
 *   ## Summary / Rationale / Proposed Change / Execution Steps / Verification
 *
 * 用于：当自主运行（dream）升级为"可执行工作区变更"时，计划的落盘与校验格式。
 * 当前 dream 引擎仅做知识/记忆处理（不直接改工作区），本契约作为基础设施先行落地。
 */
import { randomUUID } from 'crypto';

/** 计划元数据（> 块第一行声明 + 键值对） */
export interface DreamPlanMeta {
  id: string;
  projectRoot: string;
  createdAt: number;
  dedupeKey: string;
}

/** 解析后的计划结构 */
export interface DreamPlan {
  title: string;
  meta: DreamPlanMeta;
  summary: string;
  rationale: string;
  proposedChange: string;
  executionSteps: string[];
  verification: string;
  raw: string;
}

/** 计划校验结果 */
export interface DreamPlanValidation {
  ok: boolean;
  errors: string[];
}

const REQUIRED_SECTIONS = [
  'Summary',
  'Rationale',
  'Proposed Change',
  'Execution Steps',
  'Verification',
] as const;

/** 解析元数据块（> 行） */
function parseMeta(metaLines: string[]): DreamPlanMeta | null {
  if (metaLines.length === 0) return null;
  const firstLine = metaLines[0]!.trim();
  if (!firstLine.startsWith('Dream Plan')) return null;
  const meta: Partial<DreamPlanMeta> = {};
  for (const line of metaLines.slice(1)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key === 'id') meta.id = value;
    else if (key === 'projectRoot') meta.projectRoot = value;
    else if (key === 'createdAt') meta.createdAt = Number(value);
    else if (key === 'dedupeKey') meta.dedupeKey = value;
  }
  if (!meta.id || !meta.projectRoot || !meta.createdAt || !meta.dedupeKey) {
    return null;
  }
  return meta as DreamPlanMeta;
}

/**
 * 解析计划 markdown（严格模式：标题/元数据/5 个必需节，顺序不强制）
 */
export function parseDreamPlan(markdown: string): DreamPlan | null {
  const lines = markdown.split('\n');

  // 1. 标题（# 开头）
  const titleLine = lines.find((l) => l.startsWith('# '));
  if (!titleLine) return null;
  const title = titleLine.slice(2).trim();

  // 2. 元数据块（连续的 > 行）
  const metaLines: string[] = [];
  let inMeta = false;
  for (const line of lines) {
    if (line.startsWith('> ')) {
      inMeta = true;
      metaLines.push(line.slice(2).trim());
    } else if (inMeta) {
      break;
    }
  }
  const meta = parseMeta(metaLines);
  if (!meta) return null;

  // 3. 提取各节内容
  const sections = new Map<string, string[]>();
  let currentSection: string | null = null;
  for (const line of lines) {
    if (line.startsWith('## ')) {
      currentSection = line.slice(3).trim();
      sections.set(currentSection, []);
    } else if (currentSection && line.trim()) {
      sections.get(currentSection)!.push(line.trim());
    }
  }

  // 4. 必需节校验（缺节即无效）
  const missing = REQUIRED_SECTIONS.filter((s) => !sections.get(s)?.length);
  if (missing.length > 0) return null;

  return {
    title,
    meta,
    summary: sections.get('Summary')!.join(' '),
    rationale: sections.get('Rationale')!.join(' '),
    proposedChange: sections.get('Proposed Change')!.join(' '),
    executionSteps: sections.get('Execution Steps')!,
    verification: sections.get('Verification')!.join(' '),
    raw: markdown,
  };
}

/**
 * 校验计划（结构化校验，返回具体错误）
 */
export function validateDreamPlan(plan: DreamPlan): DreamPlanValidation {
  const errors: string[] = [];
  if (!plan.title) errors.push('缺少标题');
  if (plan.summary.length > 200) errors.push('Summary 超过 200 字符');
  if (plan.executionSteps.length === 0) errors.push('Execution Steps 为空');
  if (!plan.verification) errors.push('缺少 Verification');
  if (/TODO|待补充|待定/i.test(plan.proposedChange)) {
    errors.push('Proposed Change 含模糊占位（TODO/待补充）');
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 构建计划 markdown（供自主执行时写入计划文件）
 */
export function buildDreamPlanMarkdown(input: {
  title: string;
  projectRoot: string;
  summary: string;
  rationale: string;
  proposedChange: string;
  executionSteps: string[];
  verification: string;
  dedupeKey?: string;
}): string {
  const meta: DreamPlanMeta = {
    id: `dream-plan-${randomUUID().replace(/-/g, '').substring(0, 12)}`,
    projectRoot: input.projectRoot,
    createdAt: Date.now(),
    dedupeKey: input.dedupeKey ?? input.title,
  };
  const lines = [
    `# ${input.title}`,
    '',
    `> Dream Plan`,
    `> id: ${meta.id}`,
    `> projectRoot: ${meta.projectRoot}`,
    `> createdAt: ${meta.createdAt}`,
    `> dedupeKey: ${meta.dedupeKey}`,
    '',
    `## Summary`,
    input.summary,
    '',
    `## Rationale`,
    input.rationale,
    '',
    `## Proposed Change`,
    input.proposedChange,
    '',
    `## Execution Steps`,
    ...input.executionSteps.map((s, i) => `${i + 1}. ${s}`),
    '',
    `## Verification`,
    input.verification,
  ];
  return lines.join('\n');
}
