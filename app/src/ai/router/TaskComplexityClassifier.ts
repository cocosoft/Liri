/**
 * TaskComplexityClassifier — 上下文感知的任务复杂度分类器
 *
 * 两阶段策略：
 *   第一阶段（Prompt-Time）：基于任务描述 + 已读文件数
 *   第二阶段（执行中）：基于实际工具调用模式动态调整（双向：可升可降）
 *
 * 复杂度级别：simple → medium → complex
 */

import { getLogger } from '@modules/monitoring';
const logger = getLogger('ai:complexity');

export type Complexity = 'simple' | 'medium' | 'complex';

/**
 * 写操作工具名清单（复杂度升级路径判据）。
 *
 * ⚠️ 2026-09-29（工具名漂移修复，台账 D-37）：原清单**混有 CC 名**
 *（`Write`/`Edit`/`SubAgent`）—— 它们在本仓**不存在** ⇒ 永不命中；
 * 按既定策略"本仓无对应工具者**直接移除**、不臆造近义名"清理。真名本就在列。
 *
 * 导出仅为**防漂移守卫**可在用例里直接断言（对齐 `DreamPhases.READ_ONLY_TOOLS` 的做法）。
 */
export const COMPLEXITY_WRITE_TOOLS: readonly string[] = [
  'file_edit',
  'file_write',
  'agent',
];

/**
 * 只读工具名清单（复杂度降级路径判据）。
 *
 * ⚠️ 同上清理：`Read`/`Grep`/`Glob`/`SearchCodebase` 均为 CC 名 ⇒ 永不命中
 *（真名 `file_read`/`grep` 已在列）。
 *
 * 导出仅为**防漂移守卫**可在用例里直接断言。
 */
export const COMPLEXITY_READ_TOOLS: readonly string[] = ['file_read', 'grep'];

export interface ClassifyContext {
  /** 用户输入长度 */
  descriptionLength: number;
  /** 已读取的文件数 */
  filesRead: number;
  /** 已使用的工具名列表 */
  toolsUsed?: string[];
}

/** 第一阶段（Prompt-Time 快判） */
export function classifyComplexity(ctx: ClassifyContext): Complexity {
  const { descriptionLength, filesRead } = ctx;

  // 已读文件 0-1 个 + 短描述 → simple
  if (filesRead <= 1 && descriptionLength < 100) {
    return 'simple';
  }

  // 已读文件 >5 个 → 至少 medium
  if (filesRead > 5) {
    return 'medium';
  }

  // 关键词判断
  const text = String(descriptionLength); // 简化：用长度判断
  if (descriptionLength > 200) {
    return 'complex';
  }
  if (descriptionLength > 100) {
    return 'medium';
  }

  return 'simple';
}

/** 第二阶段（执行中动态调整）：双向状态机 */
export function transitionComplexity(
  current: Complexity,
  toolName: string,
  readOnlyStreak: number
): Complexity {
  // 升级路径：用了写操作 → 提升（清单见 `COMPLEXITY_WRITE_TOOLS`）
  if (COMPLEXITY_WRITE_TOOLS.includes(toolName)) {
    if (current === 'simple') return 'medium';
    if (current === 'medium') return 'complex';
  }

  // 降级路径：连续只读 → 降低（清单见 `COMPLEXITY_READ_TOOLS`）
  if (COMPLEXITY_READ_TOOLS.includes(toolName) && readOnlyStreak >= 3) {
    if (current === 'complex') return 'medium';
    if (current === 'medium') return 'simple';
  }

  return current;
}

/**
 * 动态调整 VerifierAgent 置信度阈值
 * 简单任务用高阈值（容易验证），复杂任务用低阈值（避免永远通不过）
 */
export function getConfidenceThreshold(complexity: Complexity): number {
  switch (complexity) {
    case 'simple':
      return 0.8;
    case 'medium':
      return 0.7;
    case 'complex':
      return 0.6;
  }
}

logger.info('TaskComplexityClassifier initialized');
