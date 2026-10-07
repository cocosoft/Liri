/**
 * PatternSelector — 编排模式选择器（Teamwork P2a，2026-09-06）
 *
 * 输入 = 任务特征（复杂度 + 研究型标志），输出 = pattern 选择结果或 null。
 * 规则（简单判定表，描述层）：
 *   1. simple 复杂度 → 走快速路径，不套 pattern（null）
 *   2. 研究型复杂任务 → competitive_strategy（P0-3 门控同信号；当前**唯一**已接线运行时的 pattern）
 *   3. 其余（含 complex 非研究）→ **null** —— 如实"无 pattern 适用"
 *
 * D2/D4（2026-10-04，[`pattern-trigger-surfaces.md`](../../../../.trae/specs/pattern-trigger-surfaces.md) §4.1/§5 裁定「A 选择层一致化」）：
 *   · 原规则 3「其余 complex → long_task_pdl」与**描述层**（`matches = { complexity: 'simple' }`，D2 运行时对齐）
 *     及**运行时**（complex 走 PDCA 阶段链；`long_task_pdl` 的 PDL 由 ChatManager 快速路径策略独立驱动、
 *     不经 pattern 装配）均矛盾 ⇒ **已删除**（消除 §1.5 选择层↔描述层不一致）。
 *   · 原规则 4 依赖的 `taskType` 在本仓**无生产者**（真实 `TaskType` 见 `ai/modelRouter.ts`，是另一套词表）
 *     ⇒ 该悬空输入已从 `PatternMatchSpec` 移除；`iterative_refine`/`parallel_distributed`/`self_verify`
 *     三者的 `matches.taskType` 同步去悬空（语义由各自 `when` 表达）。
 *
 * 未命中 → null（调用方回退现状）。**运行期行为零变化**：唯一消费点
 * （`ChatManager._maybeLaunchPdca`）只认 `route === 'research'`。
 * 与 agent 层 StrategySelector（agent 类型→路由）职责区分，不混用。
 *
 * A1（2026-10-01）：返回值改为携带完整 `descriptor`（含 `assembly`）——原仅有 `name`，
 * 消费方拿到名字也无从决策。
 */

import { getLogger } from '../loggerFacade.js';
import type { FeatureFlag } from '../featureFlags.js';
import { PATTERN_DESCRIPTORS, listPatterns } from './PatternRegistry.js';
import type {
  PatternDescriptor,
  PatternMatchSpec,
  PatternName,
  PatternSelectionRule,
} from './types.js';

const logger = getLogger('core:patterns:selector');

/** 选择结果：pattern 名 + 完整描述（消费方据此决定去向，无需二次查表） */
export interface PatternSelection {
  name: PatternName;
  /** 完整描述，含 `assembly`（装配入口 + 角色→承担方绑定） */
  descriptor: PatternDescriptor;
}

/** 闭集内取名 ⇒ 描述必定存在（Record 形态编译期保证全覆盖），无 undefined 分支 */
function selectionOf(name: PatternName): PatternSelection {
  return { name, descriptor: PATTERN_DESCRIPTORS[name] };
}

/**
 * 按名取选择结果 —— **`PatternSelection` 的唯一构造点**（PC-6，2026-10-07）
 *
 * 用途：只读目录 / 装配入口在**不经 `selectPattern`**（无任务特征）时仍需构造 `PatternSelection`
 * （例如把注册表整体列给前端）；收敛于此避免第二处手工拼 `{ name, descriptor }`。
 *
 * @param name 闭集内名 ⇒ 必有结果（重载）；宽松 `string` ⇒ 未知名返回 `undefined`
 *   （与 `getPatternDescriptor` 同口径）
 */
export function resolvePattern(name: PatternName): PatternSelection;
export function resolvePattern(name: string): PatternSelection | undefined;
export function resolvePattern(name: string): PatternSelection | undefined {
  if (!Object.prototype.hasOwnProperty.call(PATTERN_DESCRIPTORS, name)) {
    return undefined;
  }
  return selectionOf(name as PatternName);
}

/**
 * 触发规则（**唯一事实源**，2026-10-07 新增）—— 既驱动 `selectPattern`，也驱动
 * 目录的「**可达性**」判定（`isPatternReachable`）。
 *
 * 为什么需要：原 `selectPattern` 是**命令式 if** ⇒ 没有任何声明能回答"哪些模式**有触发面**"，
 * 面板因此把 `self_verify`（接线在、触发永不产出）**谎报为可用**。
 *
 * 字段语义：
 * - `complexity`：任务复杂度必须相等；
 * - `research`：声明 `true` ⇒ 要求 `spec.research === true`（缺省 = 不约束）；
 * - `feature`：命中后**仍需**开启的功能开关（缺省 = 无门控）；解析走既有唯一入口
 *   `@modules/core#feature`，本表**只声明名**，不自行读环境。
 *
 * ⚠️ `as const` 必须保留：`name` 的字面量联合被 §「无触发面原因」的 `Exclude<>` 穷尽断言消费。
 */
export const PATTERN_SELECTION_RULES = [
  {
    name: 'competitive_strategy',
    complexity: 'complex',
    research: true,
    feature: 'COMPETITIVE_STRATEGY',
  },
] as const satisfies readonly PatternSelectionRule[];

/** 规则已覆盖的 pattern 名（字面量联合） */
type ReachablePatternName = (typeof PATTERN_SELECTION_RULES)[number]['name'];

/**
 * **无触发面**的原因（编译期穷尽：`PatternName` 新增成员而既无规则、又无原因 ⇒ 编译失败）。
 *
 * 语义边界：这里说的是"**选择层永远不会产出它**"，与"装配层是否有运行路由"是**两件事**
 * （后者见 `query/patternAssembler.ts#ASSEMBLER_SPECS`）。两者都有各自的原因文案，不互相替代。
 */
const PATTERN_TRIGGER_ABSENCE_REASON: Readonly<
  Record<Exclude<PatternName, ReachablePatternName>, string>
> = {
  iterative_refine: '选择层无触发规则（无触发场景，N4）',
  parallel_distributed: '选择层无触发规则（无触发场景，N4）',
  long_task_pdl:
    '选择层无触发规则（其运行时由 ChatManager 快速路径策略独立驱动，不经 pattern 选择与装配）',
  self_verify: '选择层无触发规则（装配接线已就位，触发面未定义 —— N4）',
};

/** 该 pattern 是否有**触发面**（= 是否出现在 `PATTERN_SELECTION_RULES` 中） */
export function isPatternReachable(name: PatternName): boolean {
  return PATTERN_SELECTION_RULES.some((r) => r.name === name);
}

/** 无触发面时的原因（可达 ⇒ `undefined`） */
export function patternUnreachableReason(
  name: PatternName
): string | undefined {
  return PATTERN_TRIGGER_ABSENCE_REASON[
    name as keyof typeof PATTERN_TRIGGER_ABSENCE_REASON
  ];
}

/** 该 pattern 命中后仍需开启的功能开关（无门控 ⇒ `undefined`） */
export function patternFeatureFlag(name: PatternName): FeatureFlag | undefined {
  return PATTERN_SELECTION_RULES.find((r) => r.name === name)?.feature;
}

/**
 * 按任务特征选编排 pattern。
 *
 * 规则**全部**来自 `PATTERN_SELECTION_RULES`（见该表头注）；`simple` 复杂度不套 pattern
 * （规则均要求 `complex`）⇒ 未命中即 `null`（调用方回退现状）。
 *
 * @returns PatternSelection | null（未命中走现状）
 */
export function selectPattern(spec: PatternMatchSpec): PatternSelection | null {
  const rule = PATTERN_SELECTION_RULES.find(
    (r) =>
      r.complexity === spec.complexity &&
      (r.research === undefined || spec.research === r.research)
  );
  if (!rule) {
    logger.debug('pattern.none', { ...spec });
    return null;
  }
  logger.info('pattern.selected', { name: rule.name, ...spec });
  return selectionOf(rule.name);
}

/**
 * 装配契约自检 —— 返回问题清单（空数组 = 通过）。
 *
 * 校验：注册表键与描述一致 / roles 与 bindings 双向一一对应 / bindings 无重复角色 /
 * providers 非空 / assembler 与 PatternName 双向一一对应。
 *
 * 仅供测试与注册表自检消费：注册表是编译期常量，**不做运行期启动校验**
 * （那是"不可能失败场景"的防御分支 —— CS03）。
 */
export function validatePatterns(): string[] {
  const problems: string[] = [];
  const patterns = listPatterns();
  const usedAssemblers = new Set<string>();

  for (const d of patterns) {
    if (PATTERN_DESCRIPTORS[d.name] !== d) {
      problems.push(`${d.name}: 注册表键与描述不匹配`);
    }
    if (d.roles.length === 0) {
      problems.push(`${d.name}: roles 为空`);
    }
    if (usedAssemblers.has(d.assembly.assembler)) {
      problems.push(`${d.name}: assembler 重复（${d.assembly.assembler}）`);
    }
    usedAssemblers.add(d.assembly.assembler);

    const roleSet = new Set(d.roles);
    const boundRoles = d.assembly.bindings.map((b) => b.role);
    const boundSet = new Set(boundRoles);
    if (boundSet.size !== boundRoles.length) {
      problems.push(`${d.name}: bindings 存在重复角色`);
    }
    for (const role of roleSet) {
      if (!boundSet.has(role)) problems.push(`${d.name}: 角色 ${role} 无绑定`);
    }
    for (const role of boundSet) {
      if (!roleSet.has(role)) {
        problems.push(`${d.name}: 绑定角色 ${role} 不在 roles 中`);
      }
    }
    for (const b of d.assembly.bindings) {
      if (b.providers.length === 0) {
        problems.push(`${d.name}: 角色 ${b.role} 的 providers 为空`);
      }
    }
  }

  if (usedAssemblers.size !== patterns.length) {
    problems.push('assembler 与 PatternName 非一一对应');
  }
  return problems;
}
