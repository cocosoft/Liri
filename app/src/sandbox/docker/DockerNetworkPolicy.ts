/**
 * Docker 网络策略
 * 定义网络隔离策略，校验网络模式配置，运行时执行网络策略
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

export interface NetworkEnforcementResult {
  allowed: boolean;
  reason: string;
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

/**
 * 域名匹配辅助函数
 * 支持精确匹配和通配符匹配（例如 *.example.com）
 */
function matchDomain(pattern: string, target: string): boolean {
  if (pattern === target) return true;
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1);
    return target.endsWith(suffix) && target !== suffix.slice(1);
  }
  if (pattern.startsWith('*')) {
    const suffix = pattern.slice(1);
    return target.endsWith(suffix);
  }
  return false;
}

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

  if (
    config.allowedPorts &&
    config.allowedPorts.some((p) => p <= 0 || p > 65535)
  ) {
    return {
      valid: false,
      reason: `端口白名单中存在无效端口号，有效范围 1-65535`,
    };
  }

  if (
    config.blockedDomains &&
    config.blockedDomains.some((d) => !d || d.trim().length === 0)
  ) {
    return {
      valid: false,
      reason: '域名黑名单中包含空域名条目',
    };
  }

  return { valid: true };
}

/**
 * 网络策略运行时执行器
 * 在沙箱容器运行时根据策略配置实时裁决网络请求
 */
export class NetworkPolicyEnforcer {
  private readonly config: DockerNetworkConfig;

  constructor(config: DockerNetworkConfig) {
    this.config = { ...config };
  }

  /**
   * 检查域名是否允许访问
   * 优先级：blockedDomains > allowedDomains > 默认允许
   */
  checkDomain(domain: string): NetworkEnforcementResult {
    if (this.config.mode === 'none') {
      return { allowed: false, reason: `网络模式为 none，禁止所有网络访问` };
    }

    if (domain.includes(':')) {
      domain = domain.split(':')[0];
    }

    const lowerDomain = domain.toLowerCase();

    if (this.config.blockedDomains && this.config.blockedDomains.length > 0) {
      for (const blocked of this.config.blockedDomains) {
        if (matchDomain(blocked.toLowerCase(), lowerDomain)) {
          return {
            allowed: false,
            reason: `域名 ${domain} 在黑名单中（匹配规则: ${blocked}）`,
          };
        }
      }
    }

    if (this.config.allowedDomains && this.config.allowedDomains.length > 0) {
      for (const allowed of this.config.allowedDomains) {
        if (matchDomain(allowed.toLowerCase(), lowerDomain)) {
          return {
            allowed: true,
            reason: `域名 ${domain} 在白名单中（匹配规则: ${allowed}）`,
          };
        }
      }
      return { allowed: false, reason: `域名 ${domain} 不在白名单中，已拒绝` };
    }

    return { allowed: true, reason: `域名 ${domain} 未被策略限制` };
  }

  /**
   * 检查端口是否允许访问
   */
  checkPort(port: number): NetworkEnforcementResult {
    if (this.config.mode === 'none') {
      return { allowed: false, reason: `网络模式为 none，禁止所有网络访问` };
    }

    if (port <= 0 || port > 65535) {
      return { allowed: false, reason: `端口 ${port} 无效，有效范围 1-65535` };
    }

    if (this.config.allowedPorts && this.config.allowedPorts.length > 0) {
      if (this.config.allowedPorts.includes(port)) {
        return { allowed: true, reason: `端口 ${port} 在白名单中` };
      }
      return { allowed: false, reason: `端口 ${port} 不在白名单中，已拒绝` };
    }

    return { allowed: true, reason: `端口 ${port} 未被策略限制` };
  }

  /**
   * 一站式检查：域名 + 端口
   */
  checkConnection(domain: string, port?: number): NetworkEnforcementResult {
    const domainResult = this.checkDomain(domain);
    if (!domainResult.allowed) return domainResult;

    if (port !== undefined) {
      return this.checkPort(port);
    }

    return domainResult;
  }

  /**
   * 获取当前策略配置的快照（用于日志/审计）
   */
  getPolicySnapshot(): Record<string, unknown> {
    return {
      mode: this.config.mode,
      customNetworkName: this.config.customNetworkName,
      allowedDomainCount: this.config.allowedDomains?.length ?? 0,
      blockedDomainCount: this.config.blockedDomains?.length ?? 0,
      allowedPortCount: this.config.allowedPorts?.length ?? 0,
      allowedDomains: this.config.allowedDomains,
      blockedDomains: this.config.blockedDomains,
      allowedPorts: this.config.allowedPorts,
    };
  }

  /**
   * 将策略转换为 Docker 安全选项
   */
  toDockerSecurityOpts(): string[] {
    const opts: string[] = [];
    for (const domain of this.config.blockedDomains ?? []) {
      opts.push(`block-domain:${domain}`);
    }
    return opts;
  }
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
