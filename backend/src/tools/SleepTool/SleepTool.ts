// @ts-nocheck
/**
 * Sleep工具
 * 用于延迟执行
 */
import { BaseTool } from '../BaseTool.js';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index.js';

/**
 * Sleep工具类
 */
export class SleepTool extends BaseTool {
  /**
   * 工具名称
   */
  name = 'SleepTool';

  /**
   * 工具描述
   */
  description = '延迟执行指定的毫秒数';

  /**
   * 工具参数
   */
  params: ToolParam[] = [
    {
      name: 'milliseconds',
      type: 'integer',
      description: '延迟的毫秒数',
      required: true,
      minimum: 1,
      maximum: 300000, // 5分钟上限
    },
  ];

  /**
   * 执行工具
   * @param input 工具输入
   * @param context 工具使用上下文
   * @returns 工具执行结果
   */
  async execute(input: any, context: ToolUseContext): Promise<ToolResult> {
    try {
      const { milliseconds } = input;

      // 验证参数
      if (typeof milliseconds !== 'number' || milliseconds < 1 || milliseconds > 300000) {
        return {
          success: false,
          error: 'Invalid milliseconds value. Must be between 1 and 300000.',
        };
      }

      // 执行延迟
      await new Promise((resolve) => setTimeout(resolve, milliseconds));

      return {
        success: true,
        data: {
          message: `Slept for ${milliseconds} milliseconds`,
          milliseconds,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to sleep: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
