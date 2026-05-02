/**
 * 键盘快捷键命令实现
 */
import type { CommandContext, CommandResult } from '../../types/index.js';

export default {
  /**
   * 执行键盘命令
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
      case 'customize':
        return this.handleCustomize(context);
      case 'reset':
        return this.handleReset(context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 列出快捷键
   */
  async handleList(context: CommandContext): Promise<CommandResult> {
    const shortcuts = [
      { key: 'Ctrl+Enter', action: '发送消息' },
      { key: 'Ctrl+Shift+C', action: '清空聊天' },
      { key: 'Ctrl+K', action: '搜索命令' },
      { key: 'Ctrl+/', action: '显示帮助' },
      { key: 'Ctrl+Shift+S', action: '保存会话' },
      { key: 'Ctrl+Z', action: '撤销' },
      { key: 'Ctrl+Y', action: '重做' },
      { key: 'Esc', action: '关闭弹窗' },
    ];

    const table = shortcuts.map(s => 
      `${s.key.padEnd(15)} ${s.action}`
    ).join('\n');

    return {
      success: true,
      type: 'text',
      message: `⌨️ 键盘快捷键:\n\n${table}`,
      data: shortcuts,
    };
  },

  /**
   * 显示特定快捷键详情
   */
  async handleShow(key: string, context: CommandContext): Promise<CommandResult> {
    if (!key) {
      return {
        success: false,
        type: 'error',
        error: '请指定快捷键',
        message: '用法: /keyboard show <快捷键>',
      };
    }

    const shortcuts: Record<string, string> = {
      'Ctrl+Enter': '发送消息',
      'Ctrl+K': '搜索命令',
      'Ctrl+/': '显示帮助',
    };

    const action = shortcuts[key] || '未找到此快捷键';

    return {
      success: true,
      type: 'text',
      message: `${key} → ${action}`,
      data: { key, action },
    };
  },

  /**
   * 自定义快捷键
   */
  async handleCustomize(context: CommandContext): Promise<CommandResult> {
    context.onDone?.('打开快捷键设置', { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: '正在打开快捷键设置页面...',
      data: { openingSettings: true },
    };
  },

  /**
   * 重置快捷键
   */
  async handleReset(context: CommandContext): Promise<CommandResult> {
    context.onDone?.('快捷键已重置', { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: '快捷键已重置为默认设置',
      data: { reset: true },
    };
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `键盘快捷键命令用法:

/keyboard list       - 列出所有快捷键
/keyboard show <键>  - 显示快捷键详情
/keyboard customize  - 自定义快捷键
/keyboard reset      - 重置快捷键
/keyboard help       - 显示此帮助信息

示例:
  /keyboard list
  /keyboard show Ctrl+K`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
