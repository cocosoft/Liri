/**
 * 工作区命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';

export default {
  /**
   * 执行工作区命令
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
      case 'open':
        return this.handleOpen(parts[1], context);
      case 'new':
        return this.handleNew(parts.slice(1).join(' '), context);
      case 'save':
        return this.handleSave(context);
      case 'close':
        return this.handleClose(context);
      case 'rename':
        return this.handleRename(parts.slice(1).join(' '), context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 列出工作区
   */
  async handleList(context: CommandContext): Promise<CommandResult> {
    const workspaces = [
      { id: 'ws-1', name: '项目A', active: true, files: 12 },
      { id: 'ws-2', name: '项目B', active: false, files: 8 },
      { id: 'ws-3', name: '个人笔记', active: false, files: 5 },
      { id: 'ws-4', name: '实验项目', active: false, files: 3 },
    ];

    const table = workspaces
      .map(
        (w) =>
          `${w.id.padEnd(10)} ${w.name.padEnd(12)} ${w.active ? '✓' : ' '} ${w.files}文件`
      )
      .join('\n');

    return {
      success: true,
      type: 'text',
      message: `工作区列表:\n\n${table}`,
      data: workspaces,
    };
  },

  /**
   * 打开工作区
   */
  async handleOpen(
    id: string,
    context: CommandContext
  ): Promise<CommandResult> {
    if (!id) {
      return {
        success: false,
        type: 'error',
        error: '请指定工作区ID或名称',
        message: '用法: /workspace open <ID或名称>',
      };
    }

    context.onDone?.(`工作区 "${id}" 已打开`, { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: `工作区 "${id}" 已打开`,
      data: { workspace: id },
    };
  },

  /**
   * 新建工作区
   */
  async handleNew(
    name: string,
    context: CommandContext
  ): Promise<CommandResult> {
    if (!name) {
      return {
        success: false,
        type: 'error',
        error: '请提供工作区名称',
        message: '用法: /workspace new <名称>',
      };
    }

    context.onDone?.(`工作区 "${name}" 已创建`, { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: `工作区 "${name}" 已创建`,
      data: { name },
    };
  },

  /**
   * 保存工作区
   */
  async handleSave(context: CommandContext): Promise<CommandResult> {
    context.onDone?.('工作区已保存', { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: '工作区已保存',
      data: { saved: true },
    };
  },

  /**
   * 关闭工作区
   */
  async handleClose(context: CommandContext): Promise<CommandResult> {
    context.onDone?.('工作区已关闭', { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: '工作区已关闭',
      data: { closed: true },
    };
  },

  /**
   * 重命名工作区
   */
  async handleRename(
    name: string,
    context: CommandContext
  ): Promise<CommandResult> {
    if (!name) {
      return {
        success: false,
        type: 'error',
        error: '请提供新名称',
        message: '用法: /workspace rename <新名称>',
      };
    }

    context.onDone?.(`工作区已重命名为 "${name}"`, { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: `工作区已重命名为 "${name}"`,
      data: { name },
    };
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `工作区命令用法:

/workspace list      - 列出工作区
/workspace open <ID> - 打开工作区
/workspace new <名称> - 新建工作区
/workspace save      - 保存工作区
/workspace close     - 关闭工作区
/workspace rename <名称> - 重命名工作区
/workspace help      - 显示此帮助信息

示例:
  /workspace list
  /workspace new 新项目`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
