/**
 * Bridge 命令实现
 * 管理远程控制桥接连接，对标 CC 的 /remote-control (rc) 命令
 */
import { isFeatureEnabled, FeatureFlag } from '@modules/utils/features.js';
import { bridgeStateStore, type BridgeState } from '@modules/bridge/state/BridgeStateStore.js';
import { readBridgeConfig } from '@modules/bridge/utils/bridgeConfig.js';
import { createBridgeMain, type BridgeMain } from '@modules/bridge/BridgeMain.js';
import { createDummySpawner } from '@modules/bridge/sessions/MultiSessionManager.js';
import type { CommandContext, CommandResult } from '@modules/commands/types';

const BRIDGE_CONFIG_PATH = './settings.json';

/** 全局 Bridge 主逻辑实例（单例） */
let bridgeMainInstance: BridgeMain | null = null;

/** 全局 Bridge 主逻辑选项（用于重建实例） */
let lastBridgeOptions: {
  config: ReturnType<typeof readBridgeConfig>;
  simulated: boolean;
} | null = null;

/**
 * 状态文本映射
 */
const STATE_LABELS: Record<BridgeState, string> = {
  ready: '待命',
  connected: '已连接',
  reconnecting: '重连中',
  failed: '故障',
};

/**
 * 解析标志参数
 */
function parseFlags(args: string): { showJson: boolean; subcommand: string; subarg: string } {
  const trimmed = args.trim();
  const showJson = /(^|\s)--json(\s|$)/.test(trimmed);
  const cleaned = trimmed.replace(/--json\s*/g, '').trim();
  const parts = cleaned.split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() || '';
  const subarg = parts.slice(1).join(' ');
  return { showJson, subcommand, subarg };
}

/**
 * 获取桥接启用状态
 */
function isBridgeModeEnabled(): boolean {
  return isFeatureEnabled(FeatureFlag.BRIDGE_MODE);
}

/**
 * 序列化状态为 JSON 对象
 */
function stateToJson(state: BridgeState): string {
  return STATE_LABELS[state] || state;
}

/**
 * 构建 JSON 输出
 */
function buildJsonStatus(): Record<string, unknown> {
  const state = bridgeStateStore.getState();
  const bm = bridgeMainInstance;
  const enabled = isBridgeModeEnabled();
  const pollStats = bm?.getPollManager()?.getStats();
  const sessionStats = bm?.getSessionManager()?.getStats();
  const heartbeatStats = bm?.getHeartbeatManager()?.getStats();

  return {
    enabled: enabled,
    bridgeState: stateToJson(state.bridgeState),
    isRunning: state.isEnabled,
    isExplicit: state.isExplicit,
    bridgeId: state.bridgeId || null,
    environmentId: state.environmentId || null,
    sessionId: state.sessionId || null,
    sessionIngressUrl: state.sessionIngressUrl || null,
    messageCount: state.messageCount,
    lastConnectedAt: state.lastConnectedAt || null,
    lastDisconnectedAt: state.lastDisconnectedAt || null,
    error: state.error || null,
    polling: pollStats ? {
      state: pollStats.state,
      totalPolls: pollStats.totalPolls,
      successfulPolls: pollStats.successfulPolls,
      failedPolls: pollStats.failedPolls,
      workReceived: pollStats.workReceived,
      consecutiveErrors: pollStats.consecutiveErrors,
      lastPollTime: pollStats.lastPollTime || null,
    } : null,
    sessions: sessionStats ? {
      activeCount: sessionStats.activeCount,
      totalCreated: sessionStats.totalCreated,
      totalCompleted: sessionStats.totalCompleted,
      totalFailed: sessionStats.totalFailed,
      totalInterrupted: sessionStats.totalInterrupted,
      averageLifetimeMs: sessionStats.averageLifetimeMs,
    } : null,
    heartbeat: heartbeatStats ? {
      state: heartbeatStats.state,
      monitoredSessions: heartbeatStats.monitoredSessions,
      totalHeartbeatsSent: heartbeatStats.totalHeartbeatsSent,
      successfulHeartbeats: heartbeatStats.successfulHeartbeats,
      failedHeartbeats: heartbeatStats.failedHeartbeats,
      lastHeartbeatTime: heartbeatStats.lastHeartbeatTime || null,
    } : null,
    activeSessions: state.sessions.map(s => ({
      id: s.id,
      directory: s.directory || null,
      createdAt: s.createdAt,
    })),
  };
}

/**
 * 创建 Bridge 实例
 */
function createBridgeInstance(config: ReturnType<typeof readBridgeConfig>, simulated: boolean): BridgeMain {
  const onSimPoll = simulated ? createSimulatedPollHandler() : undefined;

  return createBridgeMain({
    config,
    spawner: createDummySpawner(),
    logger: {
      logError: (msg: string) => console.error(msg),
      logVerbose: (msg: string) => console.log(`[Bridge] ${msg}`),
      logInfo: (msg: string) => console.log(`[Bridge] ${msg}`),
      printBanner: (_config: unknown, envId: string) => {
        console.log(`[Bridge] 环境 ID: ${envId}`);
      },
      setAttached: (_sessionId: string) => {
        // 无需操作
      },
    },
    useSimulatedApi: simulated,
    onSimulatedPoll: onSimPoll,
  });
}

/**
 * 创建模拟轮询回调
 */
function createSimulatedPollHandler(): (pollCount: number) => import('../../bridge/types/index.js').WorkResponse | null {
  let localPollCount = 0;
  return () => {
    localPollCount++;
    if (localPollCount <= 3) {
      return { id: `sim-work-${localPollCount}`, data: { type: 'healthcheck' }, secret: 'sim-secret' };
    }
    if (localPollCount === 4) {
      return { id: `sim-session-1`, data: { type: 'session', id: `sim-session-${Date.now()}` }, secret: 'sim-secret' };
    }
    return null;
  };
}

/**
 * 格式化状态文本
 */
function formatStatusText(): string {
  const state = bridgeStateStore.getState();
  const bm = bridgeMainInstance;
  const stateLabel = STATE_LABELS[state.bridgeState] || state.bridgeState;

  const lines: string[] = [];
  lines.push('═'.repeat(50));
  lines.push('  Bridge 状态');
  lines.push('═'.repeat(50));
  lines.push('');
  lines.push(`  状态:                ${stateLabel}`);
  lines.push(`  已启用:              ${state.isEnabled ? '是' : '否'}`);
  lines.push(`  显式启用:            ${state.isExplicit ? '是' : '否'}`);
  lines.push(`  Bridge ID:           ${state.bridgeId || '(未设置)'}`);
  lines.push(`  环境 ID:             ${state.environmentId || '(未连接)'}`);
  lines.push(`  会话 ID:             ${state.sessionId || '(无)'}`);
  lines.push(`  入口 URL:            ${state.sessionIngressUrl || '(无)'}`);
  lines.push(`  消息计数:            ${state.messageCount}`);
  lines.push(`  运行中:              ${bm?.getIsRunning() ? '是' : '否'}`);

  if (state.lastConnectedAt) {
    lines.push(`  最后连接:            ${new Date(state.lastConnectedAt).toLocaleString()}`);
  }
  if (state.lastDisconnectedAt) {
    lines.push(`  最后断开:            ${new Date(state.lastDisconnectedAt).toLocaleString()}`);
  }
  if (state.error) {
    lines.push(`  错误:                ${state.error}`);
  }

  const pollStats = bm?.getPollManager()?.getStats();
  if (pollStats) {
    lines.push('');
    lines.push('─'.repeat(50));
    lines.push('  轮询统计');
    lines.push(`  状态:                ${pollStats.state}`);
    lines.push(`  总计轮询:            ${pollStats.totalPolls}`);
    lines.push(`  成功轮询:            ${pollStats.successfulPolls}`);
    lines.push(`  失败轮询:            ${pollStats.failedPolls}`);
    lines.push(`  收到工作:            ${pollStats.workReceived}`);
    lines.push(`  连续错误:            ${pollStats.consecutiveErrors}`);
    if (pollStats.lastPollTime) {
      lines.push(`  最后轮询:            ${new Date(pollStats.lastPollTime).toLocaleString()}`);
    }
  }

  const sessionStats = bm?.getSessionManager()?.getStats();
  if (sessionStats) {
    lines.push('');
    lines.push('─'.repeat(50));
    lines.push('  会话统计');
    lines.push(`  活跃会话:            ${sessionStats.activeCount}`);
    lines.push(`  总计创建:            ${sessionStats.totalCreated}`);
    lines.push(`  已完成:              ${sessionStats.totalCompleted}`);
    lines.push(`  已失败:              ${sessionStats.totalFailed}`);
    lines.push(`  已中断:              ${sessionStats.totalInterrupted}`);
    if (sessionStats.averageLifetimeMs > 0) {
      const avgSec = Math.round(sessionStats.averageLifetimeMs / 1000);
      lines.push(`  平均存活:            ${avgSec} 秒`);
    }
  }

  const heartbeatStats = bm?.getHeartbeatManager()?.getStats();
  if (heartbeatStats) {
    lines.push('');
    lines.push('─'.repeat(50));
    lines.push('  心跳统计');
    lines.push(`  状态:                ${heartbeatStats.state}`);
    lines.push(`  监控会话数:          ${heartbeatStats.monitoredSessions}`);
    lines.push(`  总计发送:            ${heartbeatStats.totalHeartbeatsSent}`);
    lines.push(`  成功:                ${heartbeatStats.successfulHeartbeats}`);
    lines.push(`  失败:                ${heartbeatStats.failedHeartbeats}`);
    if (heartbeatStats.lastHeartbeatTime) {
      lines.push(`  最后心跳:            ${new Date(heartbeatStats.lastHeartbeatTime).toLocaleString()}`);
    }
  }

  lines.push('');
  lines.push('─'.repeat(50));
  lines.push(`  活跃会话列表: ${state.sessions.length} 个`);
  state.sessions.forEach(s => {
    lines.push(`    ├ ${s.id}`);
    if (s.directory) lines.push(`    │ 目录: ${s.directory}`);
    lines.push(`    │ 创建: ${new Date(s.createdAt).toLocaleString()}`);
    lines.push(`    └──`);
  });

  return lines.join('\n');
}

/**
 * 格式化配置文本
 */
function formatConfigText(): string {
  const config = readBridgeConfig(BRIDGE_CONFIG_PATH);

  const lines: string[] = [];
  lines.push('═'.repeat(50));
  lines.push('  Bridge 配置');
  lines.push('═'.repeat(50));
  lines.push('');
  lines.push(`  Bridge ID:        ${config.bridgeId}`);
  lines.push(`  机器名称:         ${config.machineName}`);
  lines.push(`  工作目录:         ${config.dir}`);
  lines.push(`  分支:             ${config.branch || '(默认)'}`);
  lines.push(`  Git 仓库:         ${config.gitRepoUrl || '(未设置)'}`);
  lines.push(`  最大会话数:       ${config.maxSessions}`);
  lines.push(`  工作类型:         ${config.workerType}`);
  lines.push(`  API 基础 URL:     ${config.apiBaseUrl}`);
  lines.push(`  会话入口 URL:     ${config.sessionIngressUrl}`);
  lines.push(`  生成模式:         ${config.spawnMode}`);
  lines.push(`  模拟模式:         ${bridgeMainInstance?.getIsRunning() ? '运行中' : '待命'}`);
  if (config.reuseEnvironmentId) {
    lines.push(`  重用环境 ID:     ${config.reuseEnvironmentId}`);
  }
  lines.push('');
  lines.push('─'.repeat(50));

  return lines.join('\n');
}

/**
 * 处理状态子命令
 */
async function handleStatus(showJson: boolean): Promise<CommandResult> {
  if (showJson) {
    return { success: true, message: JSON.stringify(buildJsonStatus(), null, 2) };
  }
  return { success: true, message: formatStatusText() };
}

/**
 * 处理配置子命令
 */
async function handleConfig(showJson: boolean): Promise<CommandResult> {
  if (showJson) {
    const config = readBridgeConfig(BRIDGE_CONFIG_PATH);
    return { success: true, message: JSON.stringify(config, null, 2) };
  }
  return { success: true, message: formatConfigText() };
}

/**
 * 处理启动子命令
 */
async function handleStart(simulated: boolean): Promise<CommandResult> {
  if (!isBridgeModeEnabled()) {
    return { success: false, message: '错误: Bridge 模式未启用（BRIDGE_MODE 功能开关未打开）' };
  }

  const state = bridgeStateStore.getState();
  if (state.isEnabled && bridgeMainInstance?.getIsRunning()) {
    return { success: true, message: 'Bridge 已经在运行中。使用 /bridge status 查看当前状态。' };
  }

  try {
    const config = readBridgeConfig(BRIDGE_CONFIG_PATH);

    if (bridgeMainInstance) {
      await bridgeMainInstance.shutdown();
      bridgeMainInstance = null;
    }

    const bm = createBridgeInstance(config, simulated);
    bridgeMainInstance = bm;
    lastBridgeOptions = { config, simulated };
    bridgeStateStore.enable(true);

    bm.run().catch(err => {
      console.error(`[Bridge] 运行错误: ${err.message}`);
      bridgeStateStore.setError(err.message);
    });

    const modeLabel = simulated ? '模拟模式' : '远程模式';
    return { success: true, message: `Bridge 已启动（${modeLabel}）。\n使用 /bridge status 查看状态。` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `启动 Bridge 失败: ${msg}` };
  }
}

/**
 * 处理停止子命令
 */
async function handleStop(): Promise<CommandResult> {
  const state = bridgeStateStore.getState();
  if (!state.isEnabled || !bridgeMainInstance) {
    return { success: true, message: 'Bridge 未在运行。' };
  }

  try {
    await bridgeMainInstance.shutdown();
    bridgeMainInstance = null;
    bridgeStateStore.disable();
    bridgeStateStore.reset();
    return { success: true, message: 'Bridge 已停止。所有连接已断开。' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, message: `停止 Bridge 失败: ${msg}` };
  }
}

/**
 * 处理连接子命令
 */
async function handleConnect(sessionId?: string): Promise<CommandResult> {
  if (!isBridgeModeEnabled()) {
    return { success: false, message: '错误: Bridge 模式未启用（BRIDGE_MODE 功能开关未打开）' };
  }

  const state = bridgeStateStore.getState();
  if (!state.isEnabled) {
    return { success: false, message: '错误: Bridge 未启动。请先使用 /bridge start。' };
  }

  bridgeStateStore.setBridgeState('connected');
  if (sessionId) {
    bridgeStateStore.setSessionId(sessionId);
  }

  bridgeStateStore.incrementMessageCount();

  const connectMsg = sessionId
    ? `已连接到远程会话 ${sessionId}`
    : '已连接到远程控制';

  return { success: true, message: `${connectMsg}\n使用 /bridge status 查看详细信息。` };
}

/**
 * 显示帮助信息
 */
function showHelp(): CommandResult {
  const message = [
    '═'.repeat(50),
    '  Bridge 命令帮助',
    '═'.repeat(50),
    '',
    '  /bridge [子命令] [参数]',
    '',
    '  子命令:',
    '    status (st)           查看 Bridge 连接状态',
    '    config (cfg)          查看 Bridge 配置详情',
    '    start (on)            启动 Bridge 服务（远程模式）',
    '    start --local         启动 Bridge（模拟模式，无需网络）',
    '    stop (off)            停止 Bridge 服务',
    '    connect [id]          连接到远程控制（可选指定会话 ID）',
    '    --json                以 JSON 格式输出（status/config）',
    '    help (?)              显示此帮助',
    '',
    '  别名:',
    '    /bridge, /rc, /remote-control',
    '',
    '  说明:',
    '    管理远程控制桥接连接，支持启动/停止服务、',
    '    查看连接状态和配置信息。模拟模式可在无网络',
    '    环境下测试 Bridge 的轮询、会话管理功能。',
    '',
    '  功能开关:',
    '    需启用 BRIDGE_MODE 功能开关方可使用。',
    '',
    '  示例:',
    '    /bridge status',
    '    /bridge status --json',
    '    /bridge config',
    '    /bridge start',
    '    /bridge start --local',
    '    /bridge stop',
    '    /bridge connect session-123',
    '─'.repeat(50),
  ].join('\n');

  return { success: true, message };
}

/**
 * bridge 命令
 */
const bridgeCommand = {
  async execute(args: string, ctx: CommandContext): Promise<CommandResult> {
    try {
      const { showJson, subcommand, subarg } = parseFlags(args);

      if (!subcommand || subcommand === 'help' || subcommand === '?') {
        if (!subcommand && !showJson) {
          const statusText = (await handleStatus(false)).message;
          const enabled = isBridgeModeEnabled();
          const lines = [
            statusText,
            '',
            '可用子命令:',
            `  /bridge status           查看连接状态`,
            `  /bridge config           查看配置详情`,
            `  /bridge start            启动 Bridge（远程模式）`,
            `  /bridge start --local    启动 Bridge（模拟模式，无需网络）`,
            `  /bridge stop             停止 Bridge`,
            `  /bridge connect [id]     连接到远程控制`,
            `  /bridge help             显示帮助`,
            '',
            `功能开关: BRIDGE_MODE = ${enabled ? '已启用' : '已禁用'}`,
          ];
          return { success: true, message: lines.join('\n') };
        }
        return showHelp();
      }

      try {
        const { logEvent } = await import('@modules/analytics/index.js');
        logEvent('tengu_bridge_view', { subcommand, showJson });
      } catch {
        // analytics 非关键
      }

      switch (subcommand) {
        case 'status':
        case 'st':
          return await handleStatus(showJson);

        case 'config':
        case 'cfg':
          return await handleConfig(showJson);

        case 'start':
        case 'on': {
          const simulated = subarg === '--simulated' || subarg === '--local';
          return await handleStart(simulated);
        }

        case 'stop':
        case 'off':
        case 'disconnect':
          return await handleStop();

        case 'connect':
          return await handleConnect(subarg || undefined);

        default:
          return { success: false, message: `未知子命令: ${subcommand}\n使用 /bridge help 查看可用命令。` };
      }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export default bridgeCommand;
