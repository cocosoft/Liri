/**
 * 标签命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';

export default {
  /**
   * 执行标签命令
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
        return this.handleRemove(parts.slice(1), context);
      case 'sessions':
        return this.handleSessions(parts[1], context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 列出所有标签
   */
  async handleList(context: CommandContext): Promise<CommandResult> {
    const tags = [
      { name: 'important', color: 'red', count: 5 },
      { name: 'work', color: 'blue', count: 12 },
      { name: 'personal', color: 'green', count: 8 },
      { name: 'bug', color: 'orange', count: 3 },
      { name: 'feature', color: 'purple', count: 7 },
    ];

    const table = tags.map(t => 
      `[${t.color.padEnd(6)}] ${t.name.padEnd(12)} ${t.count} 个会话`
    ).join('\n');

    return {
      success: true,
      type: 'text',
      message: `标签列表:\n\n${table}`,
      data: tags,
    };
  },

  /**
   * 添加标签
   */
  async handleAdd(args: string[], context: CommandContext): Promise<CommandResult> {
    const tagName = args[0];
    
    if (!tagName) {
      return {
        success: false,
        type: 'error',
        error: '请提供标签名称',
        message: '用法: /tag add <标签名>',
      };
    }

    context.onDone?.(`标签 ${tagName} 已添加`, { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: `标签 "${tagName}" 已添加`,
      data: { tagName },
    };
  },

  /**
   * 移除标签
   */
  async handleRemove(args: string[], context: CommandContext): Promise<CommandResult> {
    const tagName = args[0];
    
    if (!tagName) {
      return {
        success: false,
        type: 'error',
        error: '请提供标签名称',
        message: '用法: /tag remove <标签名>',
      };
    }

    context.onDone?.(`标签 ${tagName} 已移除`, { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: `标签 "${tagName}" 已移除`,
      data: { tagName },
    };
  },

  /**
   * 按标签列出会话
   */
  async handleSessions(tagName: string, context: CommandContext): Promise<CommandResult> {
    if (!tagName) {
      return {
        success: false,
        type: 'error',
        error: '请提供标签名称',
        message: '用法: /tag sessions <标签名>',
      };
    }

    const sessions = [
      { id: 'sess-001', name: 'API设计讨论', modified: '2024-01-15' },
      { id: 'sess-002', name: '代码审查', modified: '2024-01-14' },
      { id: 'sess-003', name: 'Bug修复', modified: '2024-01-13' },
    ];

    const table = sessions.map(s => 
      `[${s.id}] ${s.name} (${s.modified})`
    ).join('\n');

    return {
      success: true,
      type: 'text',
      message: `标签 "${tagName}" 下的会话:\n\n${table}`,
      data: { tagName, sessions },
    };
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `标签命令用法:

/tag list            - 列出所有标签
/tag add <标签名>    - 添加标签
/tag remove <标签名>  - 移除标签
/tag sessions <标签名> - 按标签列出会话
/tag help            - 显示此帮助信息

示例:
  /tag list
  /tag add important
  /tag sessions work`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
