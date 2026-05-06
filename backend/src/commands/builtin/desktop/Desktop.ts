/**
 * 桌面模式命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';

export default {
  /**
   * 执行桌面模式命令
   * @param args 子命令参数
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(' ');
    const subcommand = parts[0] || 'toggle';

    switch (subcommand.toLowerCase()) {
      case 'toggle':
        return this.handleToggle(context);
      case 'on':
        return this.handleEnable(context);
      case 'off':
        return this.handleDisable(context);
      case 'status':
        return this.handleStatus(context);
      case 'settings':
        return this.handleSettings(context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 切换桌面模式
   */
  async handleToggle(context: CommandContext): Promise<CommandResult> {
    const currentState = context.environment?.DESKTOP_MODE === 'true';
    const newState = !currentState;
    
    if (context.environment) {
      context.environment.DESKTOP_MODE = newState.toString();
    }

    const message = newState 
      ? '桌面模式已启用。应用将以独立窗口运行。'
      : '桌面模式已禁用。应用将以嵌入式方式运行。';

    context.onDone?.(`桌面模式${newState ? '已启用' : '已禁用'}`, { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message,
      data: { enabled: newState },
    };
  },

  /**
   * 启用桌面模式
   */
  async handleEnable(context: CommandContext): Promise<CommandResult> {
    if (context.environment) {
      context.environment.DESKTOP_MODE = 'true';
    }

    context.onDone?.('桌面模式已启用', { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: '桌面模式已启用。应用将以独立窗口运行。',
      data: { enabled: true },
    };
  },

  /**
   * 禁用桌面模式
   */
  async handleDisable(context: CommandContext): Promise<CommandResult> {
    if (context.environment) {
      context.environment.DESKTOP_MODE = 'false';
    }

    context.onDone?.('桌面模式已禁用', { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: '桌面模式已禁用。应用将以嵌入式方式运行。',
      data: { enabled: false },
    };
  },

  /**
   * 显示状态
   */
  async handleStatus(context: CommandContext): Promise<CommandResult> {
    const enabled = context.environment?.DESKTOP_MODE === 'true';
    
    return {
      success: true,
      type: 'text',
      message: `桌面模式: ${enabled ? '已启用' : '已禁用'}`,
      data: { enabled },
    };
  },

  /**
   * 显示设置
   */
  async handleSettings(context: CommandContext): Promise<CommandResult> {
    const settings = {
      enabled: context.environment?.DESKTOP_MODE === 'true',
      windowSize: { width: 1200, height: 800 },
      alwaysOnTop: false,
      minimizeToTray: true,
      startOnLogin: false,
    };

    return {
      success: true,
      type: 'text',
      message: `桌面模式设置:\n` +
        `- 启用: ${settings.enabled ? '是' : '否'}\n` +
        `- 窗口大小: ${settings.windowSize.width}x${settings.windowSize.height}\n` +
        `- 始终置顶: ${settings.alwaysOnTop ? '是' : '否'}\n` +
        `- 最小化到托盘: ${settings.minimizeToTray ? '是' : '否'}\n` +
        `- 开机启动: ${settings.startOnLogin ? '是' : '否'}`,
      data: settings,
    };
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `桌面模式命令用法:

/desktop toggle     - 切换桌面模式
/desktop on         - 启用桌面模式
/desktop off        - 禁用桌面模式
/desktop status     - 显示状态
/desktop settings   - 显示设置
/desktop help       - 显示此帮助信息

示例:
  /desktop toggle
  /desktop settings`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
