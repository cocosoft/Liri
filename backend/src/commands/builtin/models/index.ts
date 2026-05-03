// @ts-nocheck
/**
 * models 命令
 * 列出所有可用的 AI 模型
 */
import type { Command, CommandContext, CommandResult } from '../../types/index.js';

export const modelsCommand: Command = {
  type: 'action',
  name: 'models',
  description: '列出所有可用的 AI 模型',
  aliases: ['ml', 'list-models'],
  examples: [
    { description: '列出所有模型', command: '/models' },
    { description: '按提供商筛选', command: '/models --provider anthropic' },
  ],

  async execute(args: string[], context: CommandContext): Promise<CommandResult> {
    try {
      const lines = [
        '# 可用模型',
        '',
        '**注意**: 模型列表功能需要模型管理器支持',
        '',
        '使用 `/model` 命令查看当前选定的模型',
      ];

      return { success: true, message: lines.join('\n') };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  validate(args: string[]): { valid: boolean; error?: string } {
    if (args.includes('--provider') && args.indexOf('--provider') === args.length - 1) {
      return { valid: false, error: 'Missing value for --provider option' };
    }
    return { valid: true };
  },
};

export default modelsCommand;