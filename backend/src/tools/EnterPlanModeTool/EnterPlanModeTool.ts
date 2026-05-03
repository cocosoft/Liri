// @ts-nocheck
/**
 * 进入计划模式工具
 * 用于进入计划模式，让用户能够制定详细的执行计划
 * 参考CC源码 cc_code/backend/tools/EnterPlanModeTool/EnterPlanModeTool.ts 实现
 */

import { BaseTool } from '../BaseTool';
import { ToolResult, createToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import type { ToolCallProgress } from '../types/Tool';

/**
 * 进入计划模式输出
 */
export interface EnterPlanModeOutput {
  success: boolean;
  message: string;
  mode: 'plan';
}

/**
 * 进入计划模式工具
 */
export class EnterPlanModeTool extends BaseTool<void, EnterPlanModeOutput> {
  /**
   * 工具名称
   */
  name = 'EnterPlanMode';

  /**
   * 工具描述
   */
  description =
    '进入计划模式，让用户能够制定详细的执行计划。在此模式下，Agent将专注于分析需求并生成详细的执行步骤。';

  /**
   * 工具参数
   */
  params = [];

  /**
   * 搜索提示
   */
  searchHint = 'enter planning mode to create detailed plan';

  /**
   * 最大结果大小
   */
  maxResultSizeChars = 100_000;

  /**
   * 延迟加载
   */
  shouldDefer = false;

  /**
   * 检查工具是否启用
   */
  isEnabled(): boolean {
    return true;
  }

  /**
   * 检查工具是否破坏性操作
   */
  isDestructive(): boolean {
    return false;
  }

  /**
   * 检查工具是否并发安全
   */
  isConcurrencySafe(): boolean {
    return true;
  }

  /**
   * 执行进入计划模式
   */
  async execute(
    _input: void,
    _context: ToolUseContext,
    _onProgress?: ToolCallProgress
  ): Promise<ToolResult<EnterPlanModeOutput>> {
    return createToolResult(
      {
        success: true,
        message: '已进入计划模式。请提供您的需求，我将为您制定详细的执行计划。',
        mode: 'plan',
      },
      {
        newMessages: [
          {
            role: 'system',
            content: '🎯 已进入计划模式\n\n请描述您的需求或目标，我将为您制定详细的执行计划。\n\n在计划模式下，我会：\n1. 分析您的需求\n2. 分解任务步骤\n3. 评估执行风险\n4. 生成详细的执行计划\n\n输入您的需求即可开始规划！',
          },
        ],
      }
    );
  }

  /**
   * 获取用户可见的名称
   */
  userFacingName(): string {
    return '进入计划模式';
  }

  /**
   * 获取活动描述
   */
  getActivityDescription(): string | null {
    return '进入计划模式';
  }
}

/**
 * 创建进入计划模式工具实例
 */
export function createEnterPlanModeTool(): EnterPlanModeTool {
  return new EnterPlanModeTool();
}