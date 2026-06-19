/**
 * 快捷键管理命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands';

export default {
  /**
   * 执行keybindings命令
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
      case 'reset':
        return this.handleReset(context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 列出所有快捷键
   */
  async handleList(context: CommandContext): Promise<CommandResult> {
    const keybindings = [
      { key: 'Ctrl+C', action: '中断当前操作' },
      { key: 'Ctrl+D', action: '退出' },
      { key: 'Ctrl+L', action: '清屏' },
      { key: 'Ctrl+P', action: '命令历史' },
      { key: 'Tab', action: '自动补全' },
      { key: 'Up/Down', action: '上下浏览' },
      { key: 'Enter', action: '执行命令' },
      { key: 'Esc', action: '取消输入' },
    ];

    const table = keybindings
      .map((k) => `${k.key.padEnd(12)} - ${k.action}`)
      .join('\n');

    return {
      success: true,
      type: 'text',
      message: `快捷键列表:\n\n${table}\n\n使用 /keybindings show <快捷键> 查看详情`,
      data: keybindings,
    };
  },

  /**
   * 显示特定快捷键详情
   */
  async handleShow(
    key: string,
    context: CommandContext
  ): Promise<CommandResult> {
    const keybindings: Record<string, { action: string; description: string }> =
      {
        'ctrl+c': {
          action: '中断当前操作',
          description: '立即停止正在执行的命令或操作',
        },
        'ctrl+d': { action: '退出', description: '退出当前会话或程序' },
        'ctrl+l': { action: '清屏', description: '清空终端屏幕' },
        'ctrl+p': { action: '命令历史', description: '显示命令历史记录' },
        tab: { action: '自动补全', description: '自动补全命令或路径' },
        esc: { action: '取消输入', description: '取消当前输入' },
      };

    const info = keybindings[key.toLowerCase()];

    if (info) {
      return {
        success: true,
        type: 'text',
        message:
          `${key}\n` +
          `- 操作: ${info.action}\n` +
          `- 描述: ${info.description}`,
        data: info,
      };
    }

    return {
      success: false,
      type: 'error',
      error: `未找到快捷键: ${key}`,
    };
  },

  /**
   * 重置快捷键配置
   */
  async handleReset(context: CommandContext): Promise<CommandResult> {
    context.onDone?.('快捷键配置已重置为默认值', { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: '快捷键配置已重置为默认值',
    };
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `快捷键管理命令用法:

/keybindings list     - 列出所有快捷键
/keybindings show <键> - 显示特定快捷键详情
/keybindings reset    - 重置为默认配置
/keybindings help     - 显示此帮助信息

示例:
  /keybindings list
  /keybindings show ctrl+c`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
