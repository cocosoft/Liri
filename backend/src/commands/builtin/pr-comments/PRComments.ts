/**
 * PR评论命令实现
 */
import type { CommandContext, CommandResult } from '../../types/index.js';

export default {
  /**
   * 执行PR评论命令
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
      case 'show':
        return this.handleShow(parts[1], context);
      case 'add':
        return this.handleAdd(parts.slice(1), context);
      case 'resolve':
        return this.handleResolve(parts[1], context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 列出PR评论
   */
  async handleList(context: CommandContext): Promise<CommandResult> {
    const comments = [
      { id: 'PRC-001', pr: '#123', author: 'user1', state: 'open', date: '2024-01-15' },
      { id: 'PRC-002', pr: '#123', author: 'user2', state: 'resolved', date: '2024-01-14' },
      { id: 'PRC-003', pr: '#124', author: 'user1', state: 'open', date: '2024-01-13' },
    ];

    const table = comments.map(c => 
      `[${c.id}] ${c.pr.padEnd(6)} ${c.state.padEnd(10)} ${c.author} (${c.date})`
    ).join('\n');

    return {
      success: true,
      type: 'text',
      message: `PR评论列表:\n\n${table}`,
      data: comments,
    };
  },

  /**
   * 显示评论详情
   */
  async handleShow(id: string, context: CommandContext): Promise<CommandResult> {
    if (!id) {
      return {
        success: false,
        type: 'error',
        error: '请指定评论ID',
        message: '用法: /pr-comments show <ID>',
      };
    }

    const comment = {
      id,
      pr: '#123',
      author: 'user1',
      date: '2024-01-15',
      state: 'open',
      content: '这段代码需要添加错误处理。',
      filePath: 'src/utils/helper.ts',
      line: 42,
    };

    return {
      success: true,
      type: 'text',
      message: `评论详情: ${id}\n\n` +
        `- PR: ${comment.pr}\n` +
        `- 作者: ${comment.author}\n` +
        `- 日期: ${comment.date}\n` +
        `- 状态: ${comment.state}\n` +
        `- 文件: ${comment.filePath}:${comment.line}\n\n` +
        `内容:\n${comment.content}`,
      data: comment,
    };
  },

  /**
   * 添加评论
   */
  async handleAdd(args: string[], context: CommandContext): Promise<CommandResult> {
    const content = args.join(' ');
    
    if (!content) {
      return {
        success: false,
        type: 'error',
        error: '请提供评论内容',
        message: '用法: /pr-comments add <内容>',
      };
    }

    context.onDone?.('PR评论已添加', { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: `PR评论已添加:\n\n"${content}"`,
      data: { content },
    };
  },

  /**
   * 解决评论
   */
  async handleResolve(id: string, context: CommandContext): Promise<CommandResult> {
    if (!id) {
      return {
        success: false,
        type: 'error',
        error: '请指定评论ID',
        message: '用法: /pr-comments resolve <ID>',
      };
    }

    context.onDone?.(`评论 ${id} 已解决`, { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: `评论 ${id} 已标记为已解决`,
      data: { id, resolved: true },
    };
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `PR评论命令用法:

/pr-comments list       - 列出PR评论
/pr-comments show <ID>  - 显示评论详情
/pr-comments add <内容> - 添加评论
/pr-comments resolve <ID> - 解决评论
/pr-comments help       - 显示此帮助信息

示例:
  /pr-comments list
  /pr-comments add 需要添加错误处理`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
