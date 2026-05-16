/**
 * Status命令实现
 * 显示系统状态信息，支持 agent/gateway/channels 子命令
 * 对标 CC 源码 commands/builtin/status/status.tsx
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';

/**
 * 格式化字节数为可读字符串
 */
function formatMetric(value: number, unit: string): string {
  return `${value.toFixed(2)} ${unit}`;
}

/**
 * 格式化内存使用
 */
function formatMemory(bytes: number): string {
  return formatMetric(bytes / 1024 / 1024, 'MB');
}

/**
 * 处理 agent 子命令 - 显示 AI Agent 运行状态
 */
async function handleAgent(): Promise<CommandResult> {
  let agentInfo = 'Agent not initialized.';
  try {
    const { aiAgent } = await import('@modules/agent/agent.js');
    const info = aiAgent.getInfo();
    agentInfo = [
      '  ID:             ' + info.id,
      '  Name:           ' + info.name,
      '  State:          ' + info.state,
      '  Model:          ' + info.model,
      '  Strategy:       ' + info.strategy,
      '  Tool Count:     ' + info.toolCount,
    ].join('\n');
  } catch {
    agentInfo = '  Agent module not available.';
  }

  return {
    success: true,
    message: [
      '===== Agent Status =====',
      agentInfo,
      '========================',
    ].join('\n'),
  };
}

/**
 * 处理 gateway 子命令 - 显示 API 网关状态
 */
async function handleGateway(): Promise<CommandResult> {
  let gatewayInfo: string;
  try {
    const { getChannelManager } =
      await import('@modules/core/gateway/ChannelManager.js');
    const status = getChannelManager().getStatus();
    gatewayInfo = [
      '  Running:          ' + (status.isRunning ? 'Yes' : 'No'),
      '  Total Channels:   ' + status.totalChannels,
      '  Connected:        ' + status.connectedChannels,
      ...status.channels.map(
        (ch: {
          name: string;
          type: string;
          status: string;
          connected: boolean;
        }) =>
          `    ${ch.name} (${ch.type}) - ${ch.status}${ch.connected ? ' [connected]' : ''}`
      ),
    ].join('\n');
  } catch {
    gatewayInfo = '  Gateway module not available.';
  }

  return {
    success: true,
    message: [
      '===== Gateway Status =====',
      gatewayInfo,
      '==========================',
    ].join('\n'),
  };
}

/**
 * 处理 channels 子命令 - 显示通道状态
 */
async function handleChannels(): Promise<CommandResult> {
  let channelsInfo: string;
  try {
    const { getChannelManager } =
      await import('@modules/core/gateway/ChannelManager.js');
    const manager = getChannelManager();
    const channels = manager.listChannels();
    const active = channels.filter(
      (ch: { status: string; isConnected: () => boolean }) => ch.isConnected()
    );
    channelsInfo = [
      '  Total Channels: ' + channels.length,
      '  Active:         ' + active.length,
      '  Inactive:       ' + (channels.length - active.length),
      '',
      '  Active Channels:',
      ...(active.length > 0
        ? active.map(
            (ch: { name: string; type: string }) =>
              `    - ${ch.name} (${ch.type})`
          )
        : ['    (none)']),
    ].join('\n');
  } catch {
    channelsInfo = '  Channels module not available.';
  }

  return {
    success: true,
    message: [
      '===== Channels Status =====',
      channelsInfo,
      '===========================',
    ].join('\n'),
  };
}

/**
 * 显示基础系统状态
 */
function handleSystem(): CommandResult {
  return {
    success: true,
    message: [
      '===== System Status =====',
      `  Uptime:         ${process.uptime().toFixed(2)} seconds`,
      `  Node.js:        ${process.version}`,
      `  Platform:       ${process.platform}`,
      `  Architecture:   ${process.arch}`,
      `  Heap Total:     ${formatMemory(process.memoryUsage().heapTotal)}`,
      `  Heap Used:      ${formatMemory(process.memoryUsage().heapUsed)}`,
      `  RSS:            ${formatMemory(process.memoryUsage().rss)}`,
      '=========================',
    ].join('\n'),
  };
}

/**
 * Status 命令对象
 */
const statusHandler = {
  /**
   * 执行 status 命令
   * @param args 命令参数
   * @param _context 命令上下文
   */
  async execute(
    args: string,
    _context?: CommandContext
  ): Promise<CommandResult> {
    const subcommand = args.trim().toLowerCase().split(/\s+/)[0] || '';

    switch (subcommand) {
      case 'agent':
        return await handleAgent();
      case 'gateway':
        return await handleGateway();
      case 'channels':
        return await handleChannels();
      case 'system':
      case '':
        return handleSystem();
      case 'help':
      case '--help':
      case '-h':
        return {
          success: true,
          message: [
            'Status 命令帮助',
            '================',
            '',
            '用法:',
            '  /status              显示基础系统状态（默认）',
            '  /status agent        显示 AI Agent 运行状态',
            '  /status gateway      显示 API 网关状态',
            '  /status channels     显示通道状态',
            '  /status help         显示此帮助',
          ].join('\n'),
        };
      default:
        return {
          success: false,
          error: `Unknown subcommand: ${subcommand}. Use /status help to see available subcommands.`,
        };
    }
  },
};

export default statusHandler;
