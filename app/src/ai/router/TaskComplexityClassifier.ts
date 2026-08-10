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
  // 升级路径：用了写操作 → 提升
  const writeTools = [
    'file_edit',
    'file_write',
    'Write',
    'Edit',
    'Agent',
    'SubAgent',
  ];
  if (writeTools.includes(toolName)) {
    if (current === 'simple') return 'medium';
    if (current === 'medium') return 'complex';
  }

  // 降级路径：连续只读 → 降低
  const readTools = [
    'file_read',
    'Read',
    'grep',
    'Grep',
    'Glob',
    'SearchCodebase',
  ];
  if (readTools.includes(toolName) && readOnlyStreak >= 3) {
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
