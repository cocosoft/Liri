/**
 * 搜索命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';

export default {
  /**
   * 执行搜索命令
   * @param args 搜索参数
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const query = args.trim();

    if (!query) {
      return {
        success: false,
        type: 'error',
        error: '请提供搜索关键词',
        message: '用法: /search <关键词>',
      };
    }

    const results = [
      { type: 'command', name: 'clear', description: '清空聊天记录' },
      { type: 'command', name: 'context', description: '管理上下文' },
      { type: 'config', name: 'settings', description: '配置设置' },
      { type: 'file', name: 'src/utils/helper.ts', description: '工具函数' },
      { type: 'file', name: 'src/types/index.ts', description: '类型定义' },
    ];

    const resultList = results
      .map((r) => `[${r.type}] ${r.name}: ${r.description}`)
      .join('\n');

    return {
      success: true,
      type: 'text',
      message: `搜索结果 (关键词: "${query}"):\n\n${resultList}`,
      data: { query, results },
    };
  },
};
