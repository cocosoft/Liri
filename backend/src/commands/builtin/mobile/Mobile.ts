/**
 * 移动端命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';

export default {
  /**
   * 执行移动端命令
   * @param args 子命令参数
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(' ');
    const subcommand = parts[0] || 'status';

    switch (subcommand.toLowerCase()) {
      case 'status':
        return this.handleStatus(context);
      case 'qr':
        return this.handleQR(context);
      case 'pair':
        return this.handlePair(context);
      case 'unpair':
        return this.handleUnpair(context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleHelp();
    }
  },

  /**
   * 显示移动端连接状态
   */
  async handleStatus(context: CommandContext): Promise<CommandResult> {
    const status = {
      paired: false,
      deviceName: null,
      lastSync: null,
      syncStatus: 'idle',
    };

    return {
      success: true,
      type: 'text',
      message: `移动端状态:\n` +
        `- 已配对: ${status.paired ? '是' : '否'}\n` +
        `- 设备名称: ${status.deviceName || '未配对'}\n` +
        `- 最后同步: ${status.lastSync || '从未同步'}\n` +
        `- 同步状态: ${status.syncStatus}`,
      data: status,
    };
  },

  /**
   * 显示配对二维码
   */
  async handleQR(context: CommandContext): Promise<CommandResult> {
    return {
      success: true,
      type: 'text',
      message: '正在生成配对二维码...\n\n' +
        '请打开PY_APP移动应用并扫描此二维码进行配对。',
      data: { qrGenerated: true },
    };
  },

  /**
   * 配对设备
   */
  async handlePair(context: CommandContext): Promise<CommandResult> {
    context.onDone?.('正在配对设备...', { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: '正在配对设备...\n\n' +
        '请在移动设备上确认配对请求。',
      data: { pairing: true },
    };
  },

  /**
   * 取消配对
   */
  async handleUnpair(context: CommandContext): Promise<CommandResult> {
    context.onDone?.('已取消设备配对', { display: 'system' });
    
    return {
      success: true,
      type: 'text',
      message: '已取消设备配对',
      data: { paired: false },
    };
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `移动端命令用法:

/mobile status      - 显示连接状态
/mobile qr          - 显示配对二维码
/mobile pair        - 配对设备
/mobile unpair      - 取消配对
/mobile help        - 显示此帮助信息

示例:
  /mobile status
  /mobile qr`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
