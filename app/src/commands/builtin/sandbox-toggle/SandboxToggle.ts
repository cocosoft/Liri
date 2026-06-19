/**
 * 沙箱模式切换命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands';

export default {
  /**
   * 执行沙箱切换命令
   * @param args 参数（on/off/toggle/status）
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const param = args.trim().toLowerCase() || 'toggle';

    let newState: boolean;
    let action: string;

    switch (param) {
      case 'on':
        newState = true;
        action = '启用';
        break;
      case 'off':
        newState = false;
        action = '禁用';
        break;
      case 'status':
        return this.handleStatus(context);
      case 'toggle':
      default:
        const currentState = context.environment?.SANDBOX_ENABLED === 'true';
        newState = !currentState;
        action = newState ? '启用' : '禁用';
        break;
    }

    return this.handleToggle(newState, action, context);
  },

  /**
   * 显示当前状态
   */
  async handleStatus(context: CommandContext): Promise<CommandResult> {
    const enabled = context.environment?.SANDBOX_ENABLED === 'true';

    return {
      success: true,
      type: 'text',
      message: `沙箱模式: ${enabled ? '已启用' : '已禁用'}`,
      data: { enabled },
    };
  },

  /**
   * 切换沙箱模式
   */
  async handleToggle(
    enabled: boolean,
    action: string,
    context: CommandContext
  ): Promise<CommandResult> {
    if (context.environment) {
      context.environment.SANDBOX_ENABLED = enabled.toString();
    }

    const message = enabled
      ? '沙箱模式已启用。所有代码执行将在隔离环境中运行。'
      : '沙箱模式已禁用。代码将在当前环境中执行。';

    context.onDone?.(`${action}沙箱模式`, { display: 'system' });

    return {
      success: true,
      type: 'text',
      message,
      data: { enabled },
    };
  },
};
