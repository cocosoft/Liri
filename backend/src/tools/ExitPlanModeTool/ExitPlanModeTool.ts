/**
 * 退出计划模式工具
 * 用于退出计划模式，返回正常执行模式
 * 参考CC源码 cc_code/backend/tools/ExitPlanModeTool/ExitPlanModeTool.ts 实现
 */

import { BaseTool } from '../BaseTool';
import { ToolResult, createToolResult } from '../types/ToolResult';
import { ToolUseContext } from '../types/ToolUseContext';
import type { ToolCallProgress } from '../types/Tool';

/**
 * 退出计划模式输出
 */
export interface ExitPlanModeOutput {
  success: boolean;
  message: string;
  mode: 'normal';
}

/**
 * 退出计划模式工具
 */
export class ExitPlanModeTool extends BaseTool<void, ExitPlanModeOutput> {
  /**
   * 工具名称
   */
  name = 'ExitPlanMode';

  /**
   * 工具描述
   */
  description =
    '退出计划模式，返回正常执行模式。在此模式下，Agent将直接执行用户的指令。';

  /**
   * 工具参数
   */
  params = [];

  override searchHint = 'exit planning mode return to normal';

  override maxResultSizeChars = 100_000;

  override shouldDefer = false;

  override isEnabled(): boolean {
    return true;
  }

  override isDestructive(): boolean {
    return false;
  }

  override isConcurrencySafe(): boolean {
    return true;
  }

  /**
   * 执行退出计划模式
   */
  async execute(
    _input: void,
    _context: ToolUseContext,
    _onProgress?: ToolCallProgress
  ): Promise<ToolResult<ExitPlanModeOutput>> {
    return createToolResult(
      {
        success: true,
        message: '已退出计划模式，返回正常执行模式。',
        mode: 'normal',
      },
      {
        newMessages: [
          {
            role: 'system',
            content: '✅ 已退出计划模式\n\n现在返回正常执行模式。您可以直接告诉我需要执行的操作，我会立即处理。',
          },
        ],
      }
    );
  }

  override userFacingName(): string {
    return '退出计划模式';
  }

  override getActivityDescription(): string | null {
    return '退出计划模式';
  }
}

/**
 * 创建退出计划模式工具实例
 */
export function createExitPlanModeTool(): ExitPlanModeTool {
  return new ExitPlanModeTool();
}