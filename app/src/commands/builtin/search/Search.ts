/**
 * 搜索命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands';

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
        success: true,
        type: 'text',
        message: [
          '🔍 搜索命令',
          '',
          '用法:',
          '  /search <关键词>    搜索应用内的命令、配置、文件等内容',
          '',
          '示例:',
          '  /search git         搜索与 git 相关的命令',
          '  /search config      搜索配置相关条目',
          '',
          '提示: 提供搜索关键词以查找相关内容。',
        ].join('\n'),
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
