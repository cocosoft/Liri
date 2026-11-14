// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 计划**影响预演**（D7 一期，2026-11-14）
 *
 * 规格：`.trae/specs/plan-impact-preview.md`（取证：仓库**没有**任何工具/计划级 dry-run；
 * `evals` 沙箱是"整进程隔离跑评测"，不是可复用的预演原语；副作用录制尚不存在）。
 *
 * 一期口径（**零执行、零写入**）：
 * - 只读**计划台账**（`PlanStep.toolOutcomes` / `artifacts` / `dependsOn`）与**工具副作用声明**
 *   （经注入的 `resolveEffect`，避免 `tasks → tools` 循环依赖）；
 * - 产出确定性的"影响预演"：副作用分类计数、需要关注的历史动作、已产出产物、剩余步骤、风险定级；
 * - **不执行任何工具、不修改任何文件、不推断未记录的事实**（缺失即计入 `unknown` / 如实说明）。
 *
 * 真实沙箱预演（隔离执行 + 副作用录制/回放）为二期，前置见 spec §5。
 */

import { type Plan, STEP_STATUS_COMPLETED } from '../TaskOrchestrator';
import { isNonTerminalStep } from './planStartupResume';

/** 工具副作用类别（与 `tools/toolEffects.ts` 的 `ToolSideEffect` 同值域） */
export type ToolSideEffectClass = 'none' | 'local' | 'external';

/**
 * 风险定级（由历史台账事实推出，不做猜测）。
 *
 * 取值刻意避开已登记的状态词汇（`blocked` 属目标状态机的 state 值）——
 * 这里表达的是"历史上有安全拦截"，用 `intercepted` 更准确，也不污染状态词汇表。
 */
export type PlanImpactRisk = 'none' | 'local-only' | 'external' | 'intercepted';

export interface PlanImpactOptions {
  /**
   * 工具副作用解析（**注入**：`tasks` 不得静态依赖 `tools`，否则形成循环依赖）。
   * 缺省 ⇒ 所有工具调用计入 `unknown`（如实标注，不猜）。
   */
  resolveEffect?: (toolName: string) => ToolSideEffectClass | undefined;
}

export interface PlanImpactPreview {
  planId: string;
  description: string;
  steps: { total: number; completed: number; remaining: number };
  /** 历史工具调用按副作用类别聚合 */
  effects: { none: number; local: number; external: number; unknown: number };
  /** 需要人工关注的历史动作 */
  attention: {
    failed: number;
    securityIntercepted: number;
    pendingApproval: number;
  };
  /** 已产出产物路径（去重、排序） */
  artifacts: string[];
  /** 剩余步骤（1-based 序号 + 依赖序号） */
  remainingSteps: Array<{
    index: number;
    description: string;
    dependsOn: number[];
  }>;
  risk: PlanImpactRisk;
  /** 如实说明（免责声明 / 数据缺失） */
  notes: string[];
}

/** 计划内某步骤的序号（1-based）；找不到 ⇒ 0 */
function stepIndex(plan: Plan, stepId: string): number {
  const index = plan.steps.findIndex((s) => s.id === stepId);
  return index >= 0 ? index + 1 : 0;
}

/**
 * 生成影响预演（**纯函数**：同一计划 + 同一副作用声明 ⇒ 逐字相同）。
 */
export function buildPlanImpactPreview(
  plan: Plan,
  options: PlanImpactOptions = {}
): PlanImpactPreview {
  const effects = { none: 0, local: 0, external: 0, unknown: 0 };
  const attention = { failed: 0, securityIntercepted: 0, pendingApproval: 0 };
  const artifacts = new Set<string>();
  let recordedOutcomes = 0;

  for (const step of plan.steps) {
    for (const artifact of step.artifacts ?? []) {
      if (artifact.trim()) artifacts.add(artifact);
    }
    const summary = step.toolOutcomes;
    if (!summary) continue;
    attention.failed += summary.failedCount;
    attention.securityIntercepted += summary.securityIntercepted;
    attention.pendingApproval += summary.pendingApproval;
    for (const outcome of summary.outcomes) {
      recordedOutcomes += 1;
      const effect = options.resolveEffect?.(outcome.toolName);
      if (effect === 'none' || effect === 'local' || effect === 'external') {
        effects[effect] += 1;
      } else {
        effects.unknown += 1;
      }
    }
  }

  const remaining = plan.steps.filter(isNonTerminalStep);
  const completed = plan.steps.filter(
    (s) => s.status === STEP_STATUS_COMPLETED
  ).length;

  const risk: PlanImpactRisk =
    attention.securityIntercepted > 0
      ? 'intercepted'
      : effects.external > 0
        ? 'external'
        : effects.local > 0
          ? 'local-only'
          : 'none';

  const notes = [
    '本预演**不执行任何工具、不修改任何文件**；数据来自计划台账（历史工具结局 + 产物路径）。',
  ];
  if (recordedOutcomes === 0) {
    notes.push(
      '该计划尚无工具结局台账（未执行过或未采集）⇒ 预演只含进度与产物事实。'
    );
  }
  if (effects.unknown > 0) {
    notes.push(
      `${effects.unknown} 次工具调用没有副作用声明（或未注入解析器）⇒ 计为 unknown，不推断。`
    );
  }

  return {
    planId: plan.id,
    description: plan.description,
    steps: {
      total: plan.steps.length,
      completed,
      remaining: remaining.length,
    },
    effects,
    attention,
    artifacts: [...artifacts].sort(),
    remainingSteps: remaining.map((step) => ({
      index: stepIndex(plan, step.id),
      description: step.description,
      dependsOn: (step.dependsOn ?? [])
        .map((id) => stepIndex(plan, id))
        .filter((n) => n > 0),
    })),
    risk,
    notes,
  };
}

/** 渲染为人读文本（**纯函数**；供计划续接指令 / 未来面板复用） */
export function renderPlanImpactPreview(preview: PlanImpactPreview): string {
  const { steps, effects, attention, artifacts, remainingSteps, risk } =
    preview;
  const lines: string[] = [
    `## 上次执行影响（plan ${preview.planId}）`,
    '',
    `- 进度：${steps.completed}/${steps.total} 已完成，剩余 ${steps.remaining} 步`,
    `- 历史工具副作用：本地 ${effects.local} · 外部 ${effects.external} · 只读 ${effects.none} · 未声明 ${effects.unknown}`,
    `- 需要关注：失败 ${attention.failed} · 安全拦截 ${attention.securityIntercepted} · 待审批 ${attention.pendingApproval}`,
    `- 风险定级：${risk}`,
  ];
  if (artifacts.length > 0) {
    lines.push(`- 已产出产物（${artifacts.length}）：${artifacts.join('、')}`);
  }
  if (remainingSteps.length > 0) {
    lines.push(
      `- 剩余步骤：${remainingSteps
        .map((s) =>
          s.dependsOn.length > 0
            ? `${s.index}. ${s.description}（依赖 ${s.dependsOn.join('、')}）`
            : `${s.index}. ${s.description}`
        )
        .join('；')}`
    );
  }
  for (const note of preview.notes) lines.push(`- 说明：${note}`);
  return lines.join('\n');
}

/** 是否有可展示的历史影响（无台账且无产物 ⇒ 不往指令里塞空段落） */
export function hasRecordedImpact(preview: PlanImpactPreview): boolean {
  return (
    preview.artifacts.length > 0 ||
    Object.values(preview.effects).some((n) => n > 0) ||
    preview.attention.failed > 0 ||
    preview.attention.securityIntercepted > 0 ||
    preview.attention.pendingApproval > 0
  );
}
