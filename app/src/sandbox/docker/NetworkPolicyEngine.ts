/**
 * 网络策略引擎
 * 对运行中的 Docker 容器执行端口/域名维度运行时网络策略
 * 端口白名单依赖容器内 iptables（需 NET_ADMIN 权限），域名黑名单通过 /etc/hosts 实现
 */

import { execSync } from 'child_process';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';
import type { DockerNetworkConfig } from './DockerNetworkPolicy';

const logger = getLogger('sandbox:docker:networkPolicyEngine');

/**
 * 网络策略应用结果
 */
export interface PolicyApplyResult {
  domainBlocked: boolean;
  portRestricted: boolean;
  errors: string[];
}

/**
 * 判断给定网络配置是否需要 NET_ADMIN 权限
 */
export function needsNetAdmin(config: DockerNetworkConfig): boolean {
  if (config.mode === 'none') return false;
  return !!(config.allowedPorts && config.allowedPorts.length > 0);
}

/**
 * 网络策略引擎
 * 提供静态方法集合，对运行中的 Docker 容器应用网络策略规则
 */
export class NetworkPolicyEngine {
  /**
   * 对指定容器应用网络策略
   * 策略执行失败不影响沙箱主流程，仅记录警告日志
   *
   * @param containerName - 目标容器名称
   * @param config        - 网络策略配置
   */
  static applyPolicy(
    containerName: string,
    config: DockerNetworkConfig
  ): PolicyApplyResult {
    const result: PolicyApplyResult = {
      domainBlocked: false,
      portRestricted: false,
      errors: [],
    };

    if (config.mode === 'none') {
      return result;
    }

    try {
      applyDomainBlacklist(containerName, config.blockedDomains, result);
    } catch (e) {
      void handleError(e, {
        module: 'sandbox:network',
        action: 'applyDomainBlacklist',
      });
      const msg = `域名黑名单应用失败: ${(e as Error).message}`;
      logger.warn(msg);
      result.errors.push(msg);
    }

    try {
      applyPortWhitelist(containerName, config.allowedPorts, result);
    } catch (e) {
      void handleError(e, {
        module: 'sandbox:network',
        action: 'applyPortWhitelist',
      });
      const msg = `端口白名单应用失败: ${(e as Error).message}`;
      logger.warn(msg);
      result.errors.push(msg);
    }

    return result;
  }
}

/**
 * 通过 /etc/hosts 将黑名单域名指向 127.0.0.1
 * 此方法无需额外容器权限，所有镜像均支持
 */
function applyDomainBlacklist(
  containerName: string,
  blockedDomains: string[] | undefined,
  result: PolicyApplyResult
): void {
  if (!blockedDomains || blockedDomains.length === 0) return;

  for (const domain of blockedDomains) {
    execSync(
      `docker exec ${containerName} sh -c "echo '127.0.0.1 ${domain}' >> /etc/hosts"`,
      { stdio: 'pipe', timeout: 5000 }
    );
  }

  result.domainBlocked = true;
  logger.info(`域名黑名单已应用: ${blockedDomains.join(', ')}`);
}

/**
 * 通过 iptables 设置出站端口白名单
 * 先放行指定端口 + 回环 + 已建立连接，再丢弃其余出站流量
 * 容器内需要安装 iptables（Alpine 镜像可通过 apk add iptables 安装）
 */
function applyPortWhitelist(
  containerName: string,
  allowedPorts: number[] | undefined,
  result: PolicyApplyResult
): void {
  if (!allowedPorts || allowedPorts.length === 0) return;

  const cmds: string[] = [];

  cmds.push('iptables -P OUTPUT DROP');
  cmds.push('iptables -A OUTPUT -o lo -j ACCEPT');
  cmds.push(
    'iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT'
  );

  for (const port of allowedPorts) {
    cmds.push(`iptables -A OUTPUT -p tcp --dport ${port} -j ACCEPT`);
    cmds.push(`iptables -A OUTPUT -p udp --dport ${port} -j ACCEPT`);
  }

  for (const cmd of cmds) {
    execSync(`docker exec ${containerName} sh -c "${cmd}"`, {
      stdio: 'pipe',
      timeout: 5000,
    });
  }

  result.portRestricted = true;
  logger.info(`端口白名单已应用: ${allowedPorts.join(', ')}`);
}
