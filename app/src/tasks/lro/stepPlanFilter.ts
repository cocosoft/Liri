// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * P1（2026-11-10）：规划期的**纯校验步骤**过滤（纯函数，无 IO）。
 *
 * 背景（真机 `pdca_mw9g2qzz` / `pdca_mw9hyf0j`）：planner 把"读取确认 / 校验七章 /
 * grep 检查"拆成独立步骤，每个都是完整一整个 TAOR 循环（反复 glob 换 pattern），
 * 既吃轮次预算又触发 IO 循环守卫。产物读回已由 `lro/stepArtifacts` 机械补做，
 * 验收由 `ReviewGate` 统一判定 ⇒ 纯校验步骤是重复劳动，可在规划期剔除。
 *
 * 判定为"纯校验"须同时满足：
 * - **没有任何产出动作**（创建/写入/实现/修改…）—— 有产出的步骤一律保留；
 * - 且以校验类动词开头，或题干里出现校验类动词（如「读取 X 并校验 Y」）。
 *
 * 安全底线：过滤后若一步不剩 ⇒ **整体放弃过滤**（绝不产出空计划）。
 */

/** 校验类动词（开头判定） */
const VERIFY_LEAD =
  /^(?:校验|验证|确认|检查|核对|复查|复核|自检|回读|verify|validate|check|confirm)/i;
/** 校验类动词（题干判定，允许"读取 X 并校验 Y"式表述） */
const VERIFY_MENTION = /(?:校验|验证|确认|检查|核对|复查|复核|自检|回读)/;
/** 产出动作：一旦出现即视为"有实际产出"，不参与过滤 */
const PRODUCE_ACTION =
  /(?:创建|写入|新建|实现|修改|编辑|生成|补充|重构|更新|删除|create|write|implement|edit|generate|refactor|update|delete)/i;

/** 描述是否属于"纯校验步骤"（无产出动作 + 校验语义） */
export function isVerificationOnlyStep(description: string): boolean {
  const text = description.trim();
  if (!text) return false;
  if (PRODUCE_ACTION.test(text)) return false;
  return VERIFY_LEAD.test(text) || VERIFY_MENTION.test(text);
}

export interface PlanStepsFilterInput {
  steps: ReadonlyArray<string>;
  /** 与 `steps` 对齐的验收标准（可选） */
  acceptance?: ReadonlyArray<string>;
  /** 与 `steps` 对齐的依赖序号（0-based，可选） */
  dependsOn?: ReadonlyArray<ReadonlyArray<number>>;
}

export interface PlanStepsFilterResult {
  steps: string[];
  acceptance?: string[];
  dependsOn?: number[][];
  /** 被剔除步骤的**原始** 0-based 下标（供日志/遥测） */
  droppedIndexes: number[];
}

/**
 * 剔除纯校验步骤，并**同步重映射**验收标准与依赖序号。
 *
 * 依赖清理口径：被剔除步骤的引用直接丢弃；剩余依赖重映射到新下标，
 * 并过滤掉"不小于自身"的下标（与 `createPlan` 的"只认前置"一致）。
 */
export function dropVerificationOnlySteps(
  input: PlanStepsFilterInput
): PlanStepsFilterResult {
  const droppedIndexes = input.steps
    .map((step, index) => (isVerificationOnlyStep(step) ? index : -1))
    .filter((index) => index >= 0);

  const untouched = (): PlanStepsFilterResult => ({
    steps: [...input.steps],
    acceptance: input.acceptance ? [...input.acceptance] : undefined,
    dependsOn: input.dependsOn
      ? input.dependsOn.map((deps) => [...deps])
      : undefined,
    droppedIndexes: [],
  });

  if (droppedIndexes.length === 0) return untouched();

  const dropped = new Set(droppedIndexes);
  const kept = input.steps
    .map((_, index) => index)
    .filter((i) => !dropped.has(i));
  // 全部是校验步骤 ⇒ 说明本阶段本身就是"验收阶段"，过滤会让计划为空
  if (kept.length === 0) return untouched();

  const indexMap = new Map(
    kept.map((oldIndex, newIndex) => [oldIndex, newIndex])
  );
  const dependsOn = input.dependsOn
    ? kept.map((oldIndex) => {
        const newIndex = indexMap.get(oldIndex) ?? 0;
        return (input.dependsOn?.[oldIndex] ?? [])
          .filter((dep) => !dropped.has(dep))
          .map((dep) => indexMap.get(dep))
          .filter(
            (dep): dep is number => typeof dep === 'number' && dep < newIndex
          );
      })
    : undefined;

  return {
    steps: kept.map((i) => input.steps[i] ?? ''),
    acceptance: input.acceptance
      ? kept.map((i) => input.acceptance?.[i] ?? '')
      : undefined,
    dependsOn,
    droppedIndexes,
  };
}
