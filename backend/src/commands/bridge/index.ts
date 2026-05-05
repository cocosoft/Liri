/**
 * Bridge命令
 * 管理远程控制桥接连接
 * 对标 CC 的 /remote-control (rc) 命令
 */

import { isFeatureEnabled, FeatureFlag } from '../../utils/features.js';
import { bridgeStateStore, type BridgeState } from '../../bridge/state/BridgeStateStore.js';
import { readBridgeConfig } from '../../bridge/utils/bridgeConfig.js';
import { createBridgeMain, type BridgeMain } from '../../bridge/BridgeMain.js';
import { createDummySpawner } from '../../bridge/sessions/MultiSessionManager.js';
import type { Command, CommandImplementation } from '../types/index.js';

const BRIDGE_CONFIG_PATH = './settings.json';

/** 全局 Bridge 主逻辑实例（单例） */
let bridgeMainInstance: BridgeMain | null = null;

/** 全局 Bridge 主逻辑选项（用于重建实例） */
let lastBridgeOptions: {
  config: ReturnType<typeof readBridgeConfig>;
  simulated: boolean;
} | null = null;

/**
 * 格式化桥接状态为可读字符串
 */
function formatBridgeState(state: BridgeState): string {
  const stateMap: Record<BridgeState, string> = {
    'ready': '待命',
    'connected': '已连接',
    'reconnecting': '重连中',
    'failed': '故障',
  };
  return stateMap[state] || state;
}

/**
 * 获取桥接启用状态
 */
function isBridgeModeEnabled(): boolean {
  return isFeatureEnabled(FeatureFlag.BRIDGE_MODE);
}

/**
 * 创建 Bridge 实例
 */
function createBridgeInstance(config: ReturnType<typeof readBridgeConfig>, simulated: boolean): BridgeMain {
  const onSimPoll = simulated
    ? createSimulatedPollHandler()
    : undefined;

  return createBridgeMain({
    config,
    spawner: createDummySpawner(),
    logger: {
      logError: (msg: string) => console.error(msg),
      logVerbose: (msg: string) => console.log(`[Bridge] ${msg}`),
      logInfo: (msg: string) => console.log(`[Bridge] ${msg}`),
      printBanner: (_config, envId) => {
        console.log(`[Bridge] 环境 ID: ${envId}`);
      },
      setAttached: (_sessionId) => {
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
      return {
        id: `sim-work-${localPollCount}`,
        data: { type: 'healthcheck' },
        secret: 'sim-secret',
      };
    }
    if (localPollCount === 4) {
      return {
        id: `sim-session-1`,
        data: { type: 'session', id: `sim-session-${Date.now()}` },
        secret: 'sim-secret',
      };
    }
    return null;
  };
}

/**
 * 处理状态子命令
 */
async function handleStatus(): Promise<string> {
  const state = bridgeStateStore.getState();
  const bm = bridgeMainInstance;

  const lines: string[] = [];
  lines.push('═'.repeat(50));
  lines.push('  Bridge 状态');
  lines.push('═'.repeat(50));
  lines.push('');
  lines.push(`  状态:                ${formatBridgeState(state.bridgeState)}`);
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

  // 轮询统计
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

  // 会话统计
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

  // 心跳统计
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
 * 处理配置子命令
 */
async function handleConfig(): Promise<string> {
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
 * 处理启动子命令
 */
async function handleStart(simulated: boolean): Promise<string> {
  if (!isBridgeModeEnabled()) {
    return '错误: Bridge 模式未启用（BRIDGE_MODE 功能开关未打开）';
  }

  const state = bridgeStateStore.getState();
  if (state.isEnabled && bridgeMainInstance?.getIsRunning()) {
    return 'Bridge 已经在运行中。使用 /bridge status 查看当前状态。';
  }

  try {
    const config = readBridgeConfig(BRIDGE_CONFIG_PATH);

    // 如果已存在实例，先关闭
    if (bridgeMainInstance) {
      await bridgeMainInstance.shutdown();
      bridgeMainInstance = null;
    }

    const bm = createBridgeInstance(config, simulated);
    bridgeMainInstance = bm;
    lastBridgeOptions = { config, simulated };
    bridgeStateStore.enable(true);

    // 异步启动，不阻塞
    bm.run().catch(err => {
      console.error(`[Bridge] 运行错误: ${err.message}`);
      bridgeStateStore.setError(err.message);
    });

    return `Bridge 已启动（${simulated ? '模拟模式' : '远程模式'}）。\n使用 /bridge status 查看状态。`;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `启动 Bridge 失败: ${msg}`;
  }
}

/**
 * 处理停止子命令
 */
async function handleStop(): Promise<string> {
  const state = bridgeStateStore.getState();
  if (!state.isEnabled || !bridgeMainInstance) {
    return 'Bridge 未在运行。';
  }

  try {
    await bridgeMainInstance.shutdown();
    bridgeMainInstance = null;
    bridgeStateStore.disable();
    bridgeStateStore.reset();
    return 'Bridge 已停止。所有连接已断开。';
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return `停止 Bridge 失败: ${msg}`;
  }
}

/**
 * 处理连接子命令
 */
async function handleConnect(sessionId?: string): Promise<string> {
  if (!isBridgeModeEnabled()) {
    return '错误: Bridge 模式未启用（BRIDGE_MODE 功能开关未打开）';
  }

  const state = bridgeStateStore.getState();
  if (!state.isEnabled) {
    return '错误: Bridge 未启动。请先使用 /bridge start。';
  }

  bridgeStateStore.setBridgeState('connected');
  if (sessionId) {
    bridgeStateStore.setSessionId(sessionId);
  }

  bridgeStateStore.incrementMessageCount();

  const connectMsg = sessionId
    ? `已连接到远程会话 ${sessionId}`
    : '已连接到远程控制';

  return `${connectMsg}\n使用 /bridge status 查看详细信息。`;
}

/**
 * Bridge命令实现
 */
export const bridgeCommand: Command = {
  name: 'bridge',
  description: '管理远程控制桥接连接',
  type: 'local',
  aliases: ['rc', 'remote-control'],
  argumentHint: '[status|start|stop|config|connect]',
  whenToUse: '管理 Bridge 远程控制连接，查看连接状态和配置',
  isHidden: false,
  load: async (): Promise<CommandImplementation> => {
    return {
      execute: async (args: string): Promise<{ success: boolean; data?: string; message?: string; error?: string }> => {
        const trimmed = args.trim();
        const parts = trimmed.split(/\s+/);
        const subcommand = parts[0]?.toLowerCase() || '';
        const subarg = parts.slice(1).join(' ');

        switch (subcommand) {
          case 'status':
          case 'st': {
            const output = await handleStatus();
            return { success: true, data: output };
          }

          case 'config':
          case 'cfg': {
            const output = await handleConfig();
            return { success: true, data: output };
          }

          case 'start':
          case 'on': {
            const simulated = subarg === '--simulated' || subarg === '--local';
            const output = await handleStart(simulated);
            return { success: true, data: output };
          }

          case 'stop':
          case 'off':
          case 'disconnect': {
            const output = await handleStop();
            return { success: true, data: output };
          }

          case 'connect': {
            const output = await handleConnect(subarg || undefined);
            return { success: true, data: output };
          }

          case 'help':
          case '?':
          case '--help':
            return { success: true, data: getHelpText() };

          default:
            if (!subcommand) {
              const status = await handleStatus();
              const enabled = isBridgeModeEnabled();
              const lines = [
                status,
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
              return { success: true, data: lines.join('\n') };
            }
            return {
              success: false,
              error: `未知子命令: ${subcommand}\n使用 /bridge help 查看可用命令。`,
            };
        }
      },
    };
  },
};

/**
 * 获取帮助文本
 */
function getHelpText(): string {
  const lines: string[] = [];
  lines.push('═'.repeat(50));
  lines.push('  Bridge 命令帮助');
  lines.push('═'.repeat(50));
  lines.push('');
  lines.push('  /bridge [子命令] [参数]');
  lines.push('');
  lines.push('  子命令:');
  lines.push('    status (st)           查看 Bridge 连接状态');
  lines.push('    config (cfg)          查看 Bridge 配置详情');
  lines.push('    start (on)            启动 Bridge 服务（远程模式）');
  lines.push('    start --local         启动 Bridge（模拟模式，无需网络）');
  lines.push('    stop (off)            停止 Bridge 服务');
  lines.push('    connect [id]          连接到远程控制（可选指定会话 ID）');
  lines.push('    help (?)              显示此帮助');
  lines.push('');
  lines.push('  别名:');
  lines.push('    /bridge, /rc, /remote-control');
  lines.push('');
  lines.push('  说明:');
  lines.push('    管理远程控制桥接连接，支持启动/停止服务、');
  lines.push('    查看连接状态和配置信息。模拟模式可在无网络');
  lines.push('    环境下测试 Bridge 的轮询、会话管理功能。');
  lines.push('');
  lines.push('  功能开关:');
  lines.push('    需启用 BRIDGE_MODE 功能开关方可使用。');
  lines.push('─'.repeat(50));

  return lines.join('\n');
}

export default bridgeCommand;
