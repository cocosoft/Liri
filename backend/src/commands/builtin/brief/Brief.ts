// @ts-nocheck
import type { CommandContext } from '../../types/index.js';
import { getToolManager } from '../../../tools/ToolManager';

/**
 * Brief命令
 * 生成当前会话的摘要
 */
export const briefCommand = {
  async call(args: string, context: CommandContext) {
    try {
      const toolManager = getToolManager();
      const briefTool = toolManager.getTool('brief');

      if (!briefTool) {
        return {
          type: 'text' as const,
          value: '错误: Brief工具未找到',
        };
      }

      // 解析参数
      const params = args.trim().split(' ');
      const options: any = {
        session_id: context.sessionId,
        max_length: 1000,
        message_count: 20,
        summary_type: 'concise',
      };

      // 处理参数
      for (const param of params) {
        if (param.startsWith('--length=')) {
          options.max_length = parseInt(param.replace('--length=', ''), 10);
        } else if (param.startsWith('--count=')) {
          options.message_count = parseInt(param.replace('--count=', ''), 10);
        } else if (param.startsWith('--type=')) {
          options.summary_type = param.replace('--type=', '');
        }
      }

      // 执行Brief工具
      const result = await briefTool.execute(options, context);

      if (result.success) {
        return {
          type: 'text' as const,
          value: result.output,
        };
      } else {
        return {
          type: 'text' as const,
          value: `错误: ${result.error || '生成摘要失败'}`,
        };
      }
    } catch (error) {
      return {
        type: 'text' as const,
        value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },
};
