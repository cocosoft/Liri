/**
 * Bridge配置管理
 * 负责加载和保存Bridge系统的配置
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { BridgeConfig, PollConfig, BackoffConfig } from '../types';

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = getLogger('bridge:utils:bridgeConfig');

/**
 * 环境变量配置键名
 */
const ENV_CONFIG_MAP: Record<keyof BridgeConfig, string> = {
  bridgeId: 'Liri_BRIDGE_ID',
  machineName: 'Liri_BRIDGE_MACHINE_NAME',
  dir: 'Liri_BRIDGE_DIR',
  branch: 'Liri_BRIDGE_BRANCH',
  gitRepoUrl: 'Liri_BRIDGE_GIT_REPO_URL',
  maxSessions: 'Liri_BRIDGE_MAX_SESSIONS',
  workerType: 'Liri_BRIDGE_WORKER_TYPE',
  apiBaseUrl: 'Liri_BRIDGE_API_BASE_URL',
  sessionIngressUrl: 'Liri_BRIDGE_SESSION_INGRESS_URL',
  reuseEnvironmentId: 'Liri_BRIDGE_REUSE_ENVIRONMENT_ID',
  spawnMode: 'Liri_BRIDGE_SPAWN_MODE',
  debugFile: 'Liri_BRIDGE_DEBUG_FILE',
};

/**
 * 读取配置文件
 */
export function readBridgeConfig(configPath: string): BridgeConfig {
  if (!existsSync(configPath)) {
    // 返回默认配置，并应用环境变量覆盖
    return applyEnvironmentOverrides(getDefaultBridgeConfig());
  }

  try {
    const content = readFileSync(configPath, 'utf8');
    const config = JSON.parse(content);
    // 应用环境变量覆盖
    return applyEnvironmentOverrides(config.bridge || getDefaultBridgeConfig());
  } catch (error) {
    void handleError(error as Error, {
      module: 'bridge:config',
      action: 'readBridgeConfig',
    });
    // 配置文件解析失败，返回默认配置，并应用环境变量覆盖
    return applyEnvironmentOverrides(getDefaultBridgeConfig());
  }
}

/**
 * 应用环境变量覆盖配置
 */
export function applyEnvironmentOverrides(config: BridgeConfig): BridgeConfig {
  const result = { ...config };

  // 遍历环境变量配置映射
  for (const [key, envKey] of Object.entries(ENV_CONFIG_MAP)) {
    const envValue = process.env[envKey];
    if (envValue !== undefined) {
      // 根据类型进行转换
      switch (key) {
        case 'maxSessions':
          (result as Record<string, unknown>)[key] =
            parseInt(envValue, 10) || config[key];
          break;
        case 'spawnMode':
          if (['single-session', 'same-dir', 'worktree'].includes(envValue)) {
            (result as Record<string, unknown>)[key] = envValue;
          }
          break;
        default:
          (result as Record<string, unknown>)[key] = envValue;
          break;
      }
    }
  }

  return result;
}

/**
 * 写入配置文件
 */
export function writeBridgeConfig(
  configPath: string,
  config: BridgeConfig
): void {
  try {
    const content = readFileSync(configPath, 'utf8');
    const fullConfig = JSON.parse(content);
    fullConfig.bridge = config;
    writeFileSync(configPath, JSON.stringify(fullConfig, null, 2));
  } catch (error) {
    void handleError(error as Error, {
      module: 'bridge:config',
      action: 'writeBridgeConfig',
    });
    // 配置文件不存在或解析失败，创建新的配置文件
    const fullConfig = {
      bridge: config,
    };
    writeFileSync(configPath, JSON.stringify(fullConfig, null, 2));
  }
}

/**
 * 获取默认Bridge配置
 */
export function getDefaultBridgeConfig(): BridgeConfig {
  return {
    bridgeId: `bridge-${Math.random().toString(36).substr(2, 9)}`,
    machineName: getMachineName(),
    dir: process.cwd(),
    maxSessions: 4,
    workerType: 'cli',
    apiBaseUrl: 'https://api.Liri.com',
    sessionIngressUrl: 'https://api.Liri.com',
    spawnMode: 'same-dir',
  };
}

/**
 * 获取默认轮询配置
 */
export function getDefaultPollConfig(): PollConfig {
  return {
    non_exclusive_heartbeat_interval_ms: 30000,
    multisession_poll_interval_ms_at_capacity: 60000,
    multisession_poll_interval_ms_partial_capacity: 5000,
    multisession_poll_interval_ms_not_at_capacity: 2000,
    reclaim_older_than_ms: 300000,
  };
}

/**
 * 获取默认退避配置
 */
export function getDefaultBackoffConfig(): BackoffConfig {
  return {
    connInitialMs: 1000,
    connCapMs: 30000,
    connGiveUpMs: 120000,
    generalInitialMs: 1000,
    generalCapMs: 15000,
    generalGiveUpMs: 60000,
    shutdownGraceMs: 5000,
    stopWorkBaseDelayMs: 2000,
  };
}

/**
 * 获取机器名称
 */
function getMachineName(): string {
  try {
    const { hostname } = require('os');
    return hostname();
  } catch (error) {
    void handleError(error as Error, {
      module: 'bridge:config',
      action: 'getMachineName',
    });
    return 'localhost';
  }
}

/**
 * 获取Bridge相关的所有环境变量
 */
export function getBridgeEnvironmentVariables(): Record<
  string,
  string | undefined
> {
  const result: Record<string, string | undefined> = {};
  for (const [_, envKey] of Object.entries(ENV_CONFIG_MAP)) {
    result[envKey] = process.env[envKey];
  }
  return result;
}

/**
 * 检查是否有任何Bridge相关的环境变量被设置
 */
export function hasBridgeEnvironmentVariables(): boolean {
  return Object.values(ENV_CONFIG_MAP).some(
    (envKey) => process.env[envKey] !== undefined
  );
}
