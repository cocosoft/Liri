/**
 * PatternSelector — 编排模式选择器（Teamwork P2a，2026-09-06）
 *
 * 输入 = 任务特征（复杂度 + 研究型标志 + 可选任务类型），输出 = pattern 名或 null。
 * 规则（简单判定表，描述层）：
 *   1. simple 复杂度 → 走快速路径，不套 pattern（null → PDL `_executeDirect` 现状）
 *   2. 研究型复杂任务 → competitive_strategy（P0-3 门控同信号）
 *   3. 其余 complex → long_task_pdl（目标驱动主路径，拓扑依赖图）
 *   4. taskType 辅助区分 write/execute/verify 描述偏好，不改变上述主判定
 *
 * 未命中 → null（调用方回退现状，行为零变化——验收 #4）。
 * 与 agent 层 StrategySelector（agent 类型→路由）职责区分，不混用。
 */

import { getLogger } from '@modules/monitoring/logs/Logger.js';
import type { PatternMatchSpec, PatternName } from './types.js';

const logger = getLogger('core:patterns:selector');

/** 选择结果：pattern 名 + 命中的描述（供消费方日志/元数据，不改执行） */
export interface PatternSelection {
  name: PatternName;
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
    return { name: 'competitive_strategy' };
  }
  // complex 非研究 → 目标驱动主路径（依赖图 / 前驱注入语义由 PDL 承担）
  logger.info('pattern.selected', { name: 'long_task_pdl', ...spec });
  return { name: 'long_task_pdl' };
}
