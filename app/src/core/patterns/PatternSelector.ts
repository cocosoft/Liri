/**
 * PatternSelector — 编排模式选择器（Teamwork P2a，2026-09-06）
 *
 * 输入 = 任务特征（复杂度 + 研究型标志 + 可选任务类型），输出 = pattern 选择结果或 null。
 * 规则（简单判定表，描述层）：
 *   1. simple 复杂度 → 走快速路径，不套 pattern（null → PDL `_executeDirect` 现状）
 *   2. 研究型复杂任务 → competitive_strategy（P0-3 门控同信号）
 *   3. 其余 complex → long_task_pdl（目标驱动主路径，拓扑依赖图）
 *   4. taskType 辅助区分 write/execute/verify 描述偏好，不改变上述主判定
 *
 * 未命中 → null（调用方回退现状，行为零变化——验收 #4）。
 * 与 agent 层 StrategySelector（agent 类型→路由）职责区分，不混用。
 *
 * A1（2026-10-01）：返回值改为携带完整 `descriptor`（含 `assembly`）——原仅有 `name`，
 * 消费方拿到名字也无从决策。规则本身逐字不变。
 */

import { getLogger } from '../loggerFacade.js';
import { PATTERN_DESCRIPTORS, listPatterns } from './PatternRegistry.js';
import type {
  PatternDescriptor,
  PatternMatchSpec,
  PatternName,
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
 * 按任务特征选编排 pattern。
 * @returns PatternSelection | null（未命中走现状）
 */
export function selectPattern(spec: PatternMatchSpec): PatternSelection | null {
  if (spec.complexity !== 'complex') {
    // simple 快速路径不套 pattern
    return null;
  }
  if (spec.research === true) {
    logger.info('pattern.selected', { name: 'competitive_strategy', ...spec });
    return selectionOf('competitive_strategy');
  }
  // complex 非研究 → 目标驱动主路径（依赖图 / 前驱注入语义由 PDL 承担）
  logger.info('pattern.selected', { name: 'long_task_pdl', ...spec });
  return selectionOf('long_task_pdl');
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
