/**
 * 贴纸命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';

export default {
  /**
   * 执行贴纸命令
   * @param args 子命令参数
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(' ');
    const subcommand = parts[0] || 'list';

    switch (subcommand.toLowerCase()) {
      case 'list':
        return this.handleList(context);
      case 'add':
        return this.handleAdd(parts.slice(1), context);
      case 'remove':
        return this.handleRemove(parts[1], context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 列出贴纸
   */
  async handleList(context: CommandContext): Promise<CommandResult> {
    const stickers = [
      { id: 1, name: '👍', category: 'emoji', used: true },
      { id: 2, name: '🎉', category: 'emoji', used: true },
      { id: 3, name: '❤️', category: 'emoji', used: true },
      { id: 4, name: '🚀', category: 'emoji', used: false },
      { id: 5, name: '💡', category: 'emoji', used: true },
      { id: 6, name: '✅', category: 'emoji', used: true },
    ];

    const table = stickers.map(s => 
      `${s.name} ${s.category.padEnd(8)} ${s.used ? '常用' : '可用'}`
    ).join('\n');

    return {
      success: true,
      type: 'text',
      message: `可用贴纸:\n\n${table}`,
      data: stickers,
    };
  },

  /**
   * 添加贴纸
   */
  async handleAdd(args: string[], context: CommandContext): Promise<CommandResult> {
    const sticker = args.join(' ');
    
    if (!sticker) {
      return {
        success: false,
        type: 'error',
        error: '请提供贴纸内容',
        message: '用法: /stickers add <贴纸>',
      };
    }

    context.onDone?.(`贴纸 "${sticker}" 已添加`, { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: `贴纸 "${sticker}" 已添加`,
      data: { sticker },
    };
  },

  /**
   * 移除贴纸
   */
  async handleRemove(sticker: string, context: CommandContext): Promise<CommandResult> {
    if (!sticker) {
      return {
        success: false,
        type: 'error',
        error: '请提供要移除的贴纸',
        message: '用法: /stickers remove <贴纸>',
      };
    }

    context.onDone?.(`贴纸 "${sticker}" 已移除`, { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: `贴纸 "${sticker}" 已移除`,
      data: { sticker },
    };
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `贴纸命令用法:

/stickers list         - 列出可用贴纸
/stickers add <贴纸>   - 添加贴纸
/stickers remove <贴纸> - 移除贴纸
/stickers help         - 显示此帮助信息

示例:
  /stickers list
  /stickers add 🚀`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
