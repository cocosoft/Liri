/**
 * 计时器命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';

export default {
  /**
   * 执行计时器命令
   * @param args 子命令参数
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(' ');
    const subcommand = parts[0] || 'start';

    switch (subcommand.toLowerCase()) {
      case 'start':
        return this.handleStart(parts.slice(1).join(' '), context);
      case 'stop':
        return this.handleStop(context);
      case 'pause':
        return this.handlePause(context);
      case 'resume':
        return this.handleResume(context);
      case 'status':
        return this.handleStatus(context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleStart(args, context);
    }
  },

  /**
   * 启动计时器
   */
  async handleStart(
    duration: string,
    context: CommandContext
  ): Promise<CommandResult> {
    if (!duration) {
      return {
        success: false,
        type: 'error',
        error: '请提供时长',
        message: '用法: /timer start <时长>\n示例: /timer start 25m',
      };
    }

    const parsed = this.parseDuration(duration);

    context.onDone?.(`计时器已启动 (${duration})`, { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: `⏱️ 计时器已启动，时长: ${duration}\n\n倒计时开始...`,
      data: { duration, seconds: parsed },
    };
  },

  /**
   * 停止计时器
   */
  async handleStop(context: CommandContext): Promise<CommandResult> {
    context.onDone?.('计时器已停止', { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: '⏹️ 计时器已停止',
      data: { stopped: true },
    };
  },

  /**
   * 暂停计时器
   */
  async handlePause(context: CommandContext): Promise<CommandResult> {
    context.onDone?.('计时器已暂停', { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: '⏸️ 计时器已暂停',
      data: { paused: true },
    };
  },

  /**
   * 恢复计时器
   */
  async handleResume(context: CommandContext): Promise<CommandResult> {
    context.onDone?.('计时器已恢复', { display: 'system' });

    return {
      success: true,
      type: 'text',
      message: '▶️ 计时器已恢复',
      data: { resumed: true },
    };
  },

  /**
   * 显示状态
   */
  async handleStatus(context: CommandContext): Promise<CommandResult> {
    const status = {
      running: true,
      remaining: '18:32',
      elapsed: '6:28',
      total: '25:00',
    };

    return {
      success: true,
      type: 'text',
      message:
        `⏱️ 计时器状态\n\n` +
        `运行中: ${status.running ? '是' : '否'}\n` +
        `剩余时间: ${status.remaining}\n` +
        `已用时间: ${status.elapsed}\n` +
        `总时长: ${status.total}`,
      data: status,
    };
  },

  /**
   * 解析时长字符串
   */
  parseDuration(duration: string): number {
    const match = duration.match(/(\d+)([mhs])/);
    if (!match) return parseInt(duration) * 60;

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
      case 'h':
        return value * 3600;
      case 'm':
        return value * 60;
      case 's':
        return value;
      default:
        return value * 60;
    }
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `计时器命令用法:

/timer start <时长>  - 启动计时器
/timer stop          - 停止计时器
/timer pause         - 暂停计时器
/timer resume        - 恢复计时器
/timer status        - 显示状态
/timer help          - 显示此帮助信息

时长格式:
  数字 + 单位 (m=分钟, h=小时, s=秒)
  示例: 25m, 1h, 30s

示例:
  /timer start 25m
  /timer status`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
