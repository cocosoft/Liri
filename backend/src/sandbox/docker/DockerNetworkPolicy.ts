/**
 * Docker 网络策略
 * 定义网络隔离策略，校验网络模式配置
 */

export type DockerNetworkMode = 'none' | 'bridge' | 'host' | 'custom';

export interface DockerNetworkConfig {
  mode: DockerNetworkMode;
  customNetworkName?: string;
  allowedDomains?: string[];
  blockedDomains?: string[];
  allowedPorts?: number[];
}

export interface NetworkValidationResult {
  valid: boolean;
  reason?: string;
}

export interface IsolationLevel {
  name: string;
  description: string;
  networkMode: DockerNetworkMode;
  readOnly: boolean;
}

export const ISOLATION_LEVELS: Record<string, IsolationLevel> = {
  maximum: {
    name: '最大隔离',
    description: '无网络访问，只读文件系统，最安全的隔离级别',
    networkMode: 'none',
    readOnly: true,
  },
  standard: {
    name: '标准隔离',
    description: '仅容器间通信，只读文件系统，适用于大多数场景',
    networkMode: 'none',
    readOnly: true,
  },
  minimal: {
    name: '最小隔离',
    description: 'Bridge 网络模式，读写文件系统，适用于需要网络访问的场景',
    networkMode: 'bridge',
    readOnly: false,
  },
  none: {
    name: '无隔离',
    description: 'Host 网络模式，与宿主机共享网络栈',
    networkMode: 'host',
    readOnly: false,
  },
};

const VALID_NETWORK_MODES: Set<string> = new Set([
  'none',
  'bridge',
  'host',
  'container',
]);

export function validateDockerNetworkConfig(
  config: Partial<DockerNetworkConfig>
): NetworkValidationResult {
  const mode = config.mode || 'none';

  if (!VALID_NETWORK_MODES.has(mode)) {
    return {
      valid: false,
      reason: `不支持的网络模式: "${mode}"，可选: ${Array.from(VALID_NETWORK_MODES).join(', ')}`,
    };
  }

  if (mode === 'custom' && !config.customNetworkName) {
    return {
      valid: false,
      reason: '自定义网络模式必须指定 customNetworkName',
    };
  }

  if (
    config.allowedDomains &&
    config.allowedDomains.length > 0 &&
    mode === 'none'
  ) {
    return {
      valid: false,
      reason: '网络模式为 "none" 时不能设置 allowedDomains',
    };
  }

  return { valid: true };
}

export function getNetworkModeForIsolation(
  level: keyof typeof ISOLATION_LEVELS
): DockerNetworkMode {
  const isolation = ISOLATION_LEVELS[level];
  return isolation ? isolation.networkMode : 'none';
}

export function getIsolationLevel(
  mode: DockerNetworkMode,
  readOnly: boolean
): string {
  for (const [level, config] of Object.entries(ISOLATION_LEVELS)) {
    if (config.networkMode === mode && config.readOnly === readOnly) {
      return level;
    }
  }
  return 'standard';
}
