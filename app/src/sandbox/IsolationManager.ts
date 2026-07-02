/**
 * 文件系统与网络隔离管理器
 * 提供受限的文件系统代理和网络访问控制
 * 插件文件操作和网络请求需经过此管理器审批
 */

import { resolve, normalize, sep } from 'path';
import { existsSync, statSync } from 'fs';
import { Logger, LogLevel } from '@modules/monitoring';
import { configManager } from '@modules/config';

const logger = new Logger({
  module: 'sandbox:isolationManager',
  level: LogLevel.INFO,
});

/**
 * 文件系统操作类型
 */
export enum FileOperation {
  READ = 'read',
  WRITE = 'write',
  DELETE = 'delete',
  EXECUTE = 'execute',
  LIST = 'list',
}

/**
 * 网络请求类型
 */
export enum NetworkOperation {
  HTTP_GET = 'http_get',
  HTTP_POST = 'http_post',
  HTTP_PUT = 'http_put',
  HTTP_DELETE = 'http_delete',
  WEBSOCKET = 'websocket',
  TCP_CONNECT = 'tcp_connect',
}

/**
 * 路径访问规则
 */
export interface PathAccessRule {
  /** 允许的路径前缀 */
  path: string;
  /** 允许的操作 */
  allowedOperations: FileOperation[];
  /** 是否递归（子路径也允许），默认 true */
  recursive: boolean;
  /** 备注 */
  description?: string;
}

/**
 * 网络访问规则
 */
export interface NetworkAccessRule {
  /** 允许的主机名或 IP */
  host: string;
  /** 允许的端口，0 表示任意端口 */
  port: number;
  /** 允许的操作 */
  allowedOperations: NetworkOperation[];
  /** 备注 */
  description?: string;
}

/**
 * 隔离策略
 */
export interface IsolationPolicy {
  pluginId: string;
  filesystem: {
    allowList: PathAccessRule[];
    denyList: string[];
    defaultDeny: boolean;
  };
  network: {
    allowList: NetworkAccessRule[];
    defaultDeny: boolean;
    allowLocalhost: boolean;
  };
}

/**
 * 路径访问检查结果
 */
export interface PathAccessResult {
  allowed: boolean;
  operation: FileOperation;
  resolvedPath: string;
  matchedRule?: PathAccessRule;
  reason?: string;
}

/**
 * 网络访问检查结果
 */
export interface NetworkAccessResult {
  allowed: boolean;
  operation: NetworkOperation;
  host: string;
  port: number;
  matchedRule?: NetworkAccessRule;
  reason?: string;
}

/**
 * 隔离管理器
 * 管理每个插件的文件系统和网络访问策略
 */
export class IsolationManager {
  private policies: Map<string, IsolationPolicy> = new Map();
  private globalDenyPaths: string[] = [];

  /**
   * 设置全局限定路径（禁止任何插件访问）
   * @param paths 禁止访问的路径列表
   */
  setGlobalDenyPaths(paths: string[]): void {
    this.globalDenyPaths = paths.map((p) => this.normalizePath(p));
  }

  /**
   * 为插件注册隔离策略
   * @param pluginId 插件 ID
   * @param policy 隔离策略
   */
  registerPolicy(pluginId: string, policy: IsolationPolicy): void {
    this.policies.set(pluginId, policy);
    logger.info(`Isolation policy registered for plugin ${pluginId}`, {
      fileRules: policy.filesystem.allowList.length,
      networkRules: policy.network.allowList.length,
    });
  }

  /**
   * 移除插件隔离策略
   * @param pluginId 插件 ID
   */
  unregisterPolicy(pluginId: string): void {
    this.policies.delete(pluginId);
  }

  /**
   * 检查文件系统访问权限
   * @param pluginId 插件 ID
   * @param operation 文件操作类型
   * @param targetPath 目标路径
   * @returns 访问检查结果
   */
  checkFileAccess(
    pluginId: string,
    operation: FileOperation,
    targetPath: string
  ): PathAccessResult {
    const resolvedPath = this.normalizePath(targetPath);
    const policy = this.policies.get(pluginId);

    if (!policy) {
      return {
        allowed: false,
        operation,
        resolvedPath,
        reason: `No isolation policy registered for plugin ${pluginId}`,
      };
    }

    for (const denyPath of this.globalDenyPaths) {
      if (resolvedPath.startsWith(denyPath)) {
        return {
          allowed: false,
          operation,
          resolvedPath,
          reason: `Access denied by global deny path: ${denyPath}`,
        };
      }
    }

    for (const denyPath of policy.filesystem.denyList) {
      const normalizedDeny = this.normalizePath(denyPath);
      if (resolvedPath.startsWith(normalizedDeny)) {
        return {
          allowed: false,
          operation,
          resolvedPath,
          reason: `Access denied by plugin deny path: ${denyPath}`,
        };
      }
    }

    for (const rule of policy.filesystem.allowList) {
      const rulePath = this.normalizePath(rule.path);
      const matches = rule.recursive
        ? resolvedPath.startsWith(rulePath)
        : resolvedPath === rulePath;

      if (matches && rule.allowedOperations.includes(operation)) {
        return {
          allowed: true,
          operation,
          resolvedPath,
          matchedRule: rule,
        };
      }
    }

    if (policy.filesystem.defaultDeny) {
      return {
        allowed: false,
        operation,
        resolvedPath,
        reason: `Access denied by default policy (no matching allow rule for ${operation} on ${resolvedPath})`,
      };
    }

    return {
      allowed: true,
      operation,
      resolvedPath,
      reason: 'Allowed by default (no deny rules matched)',
    };
  }

  /**
   * 检查网络访问权限
   * @param pluginId 插件 ID
   * @param operation 网络操作类型
   * @param host 目标主机
   * @param port 目标端口
   * @returns 网络访问检查结果
   */
  checkNetworkAccess(
    pluginId: string,
    operation: NetworkOperation,
    host: string,
    port: number
  ): NetworkAccessResult {
    const policy = this.policies.get(pluginId);

    if (!policy) {
      return {
        allowed: false,
        operation,
        host,
        port,
        reason: `No isolation policy registered for plugin ${pluginId}`,
      };
    }

    if (this.isLocalhost(host) && policy.network.allowLocalhost) {
      return {
        allowed: true,
        operation,
        host,
        port,
        reason: 'Localhost access allowed by policy',
      };
    }

    for (const rule of policy.network.allowList) {
      const hostMatch = this.hostMatches(rule.host, host);
      const portMatch = rule.port === 0 || rule.port === port;

      if (
        hostMatch &&
        portMatch &&
        rule.allowedOperations.includes(operation)
      ) {
        return {
          allowed: true,
          operation,
          host,
          port,
          matchedRule: rule,
        };
      }
    }

    if (policy.network.defaultDeny) {
      return {
        allowed: false,
        operation,
        host,
        port,
        reason: `Network access denied by default policy (no matching allow rule for ${operation} ${host}:${port})`,
      };
    }

    return {
      allowed: true,
      operation,
      host,
      port,
      reason: 'Allowed by default (no deny rules matched)',
    };
  }

  /**
   * 快速创建默认的严格隔离策略
   * 只允许访问插件自身目录
   * @param pluginId 插件 ID
   * @param pluginDir 插件目录
   * @returns 隔离策略
   */
  createStrictPolicy(pluginId: string, pluginDir: string): IsolationPolicy {
    return {
      pluginId,
      filesystem: {
        allowList: [
          {
            path: pluginDir,
            allowedOperations: [FileOperation.READ, FileOperation.LIST],
            recursive: true,
            description: 'Allow read access to plugin directory',
          },
        ],
        denyList: [],
        defaultDeny: true,
      },
      network: {
        allowList: [],
        defaultDeny: true,
        allowLocalhost: true,
      },
    };
  }

  /**
   * 快速创建默认的宽松隔离策略
   * 允许读系统路径，拒绝写系统关键路径
   * @param pluginId 插件 ID
   * @returns 隔离策略
   */
  createPermissivePolicy(pluginId: string): IsolationPolicy {
    return {
      pluginId,
      filesystem: {
        allowList: [
          {
            path: process.cwd(),
            allowedOperations: [
              FileOperation.READ,
              FileOperation.WRITE,
              FileOperation.LIST,
            ],
            recursive: true,
            description: 'Allow full access to project directory',
          },
        ],
        denyList: [
          '/etc',
          '/sys',
          '/proc',
          configManager.env('SystemRoot') || 'C:\\Windows',
        ],
        defaultDeny: true,
      },
      network: {
        allowList: [
          {
            host: '*',
            port: 0,
            allowedOperations: [
              NetworkOperation.HTTP_GET,
              NetworkOperation.HTTP_POST,
            ],
            description: 'Allow HTTP GET/POST to any host',
          },
        ],
        defaultDeny: false,
        allowLocalhost: true,
      },
    };
  }

  /**
   * 获取插件的隔离策略摘要
   */
  getPolicySummary(pluginId: string): {
    registered: boolean;
    fileRules: number;
    networkRules: number;
    defaultDeny: boolean;
  } | null {
    const policy = this.policies.get(pluginId);
    if (!policy) return null;

    return {
      registered: true,
      fileRules: policy.filesystem.allowList.length,
      networkRules: policy.network.allowList.length,
      defaultDeny: policy.filesystem.defaultDeny,
    };
  }

  /**
   * 获取所有已注册的策略
   */
  getAllPolicies(): string[] {
    return Array.from(this.policies.keys());
  }

  /**
   * 规范化路径
   */
  private normalizePath(path: string): string {
    try {
      return normalize(resolve(path)).toLowerCase();
    } catch {
      return path.toLowerCase();
    }
  }

  /**
   * 判断是否为本机地址
   */
  private isLocalhost(host: string): boolean {
    const localhostPatterns = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];
    return localhostPatterns.includes(host.toLowerCase());
  }

  /**
   * 检查主机名是否匹配规则
   * 支持通配符 *（如 *.example.com）
   */
  private hostMatches(pattern: string, host: string): boolean {
    if (pattern === '*') return true;

    const normalizedPattern = pattern.toLowerCase();
    const normalizedHost = host.toLowerCase();

    if (normalizedPattern === normalizedHost) return true;

    if (normalizedPattern.startsWith('*.')) {
      const suffix = normalizedPattern.slice(1);
      return (
        normalizedHost.endsWith(suffix) ||
        normalizedHost === normalizedPattern.slice(2)
      );
    }

    return false;
  }
}

/**
 * 全局隔离管理器单例
 */
export const isolationManager = new IsolationManager();
