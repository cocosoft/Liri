/**
 * MCP Server 自动发现
 * 对标平安科技：扫描目录/workspace 发现可用的 MCP Server
 */

import { configManager } from '@modules/config';
import fs from 'fs';
import path from 'path';
import { enhancedMcpConfigManager } from '@modules/services/mcp/EnhancedMCPConfigManager';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ module: 'mcp:autoDiscovery', level: LogLevel.INFO });

/**
 * 发现的 MCP Server 条目
 */
export interface MCPDiscoveryEntry {
  name: string;
  path: string;
  type: 'stdio' | 'sse' | 'http' | 'config';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  enabled: boolean;
  discoveredAt: number;
}

/**
 * 发现配置
 */
export interface MCPDiscoveryConfig {
  scanPaths: string[];
  scanRecursive: boolean;
  maxDepth: number;
  configFileName: string;
}

/**
 * 默认配置
 */
const DEFAULT_DISCOVERY_CONFIG: MCPDiscoveryConfig = {
  scanPaths: [
    './mcp_servers',
    './.mcp',
    `${configManager.env('HOME') || configManager.env('USERPROFILE')}/.mcp`,
    `${configManager.env('HOME') || configManager.env('USERPROFILE')}/.config/mcp`,
  ],
  scanRecursive: true,
  maxDepth: 2,
  configFileName: 'mcp-config.json',
};

/**
 * MCP Server 自动发现器
 */
export class MCPAutoDiscovery {
  private config: MCPDiscoveryConfig;
  private discovered: Map<string, MCPDiscoveryEntry> = new Map();

  /**
   * 构造函数
   * @param config 发现配置
   */
  constructor(config?: Partial<MCPDiscoveryConfig>) {
    this.config = { ...DEFAULT_DISCOVERY_CONFIG, ...config };
  }

  /**
   * 扫描所有配置的路径发现 MCP Server
   * @returns 发现的条目列表
   */
  discover(): MCPDiscoveryEntry[] {
    this.discovered.clear();
    const now = Date.now();

    for (const scanPath of this.config.scanPaths) {
      const resolved = this.resolvePath(scanPath);
      if (!fs.existsSync(resolved)) continue;

      this.scanDirectory(resolved, now, 0);
    }

    // 将发现结果同步到配置管理器
    for (const entry of this.discovered.values()) {
      if (entry.enabled) {
        enhancedMcpConfigManager.addDiscoveredServer(entry.name, {
          command: entry.command,
          args: entry.args,
          env: entry.env,
        });
      }
    }

    return Array.from(this.discovered.values());
  }

  /**
   * 扫描单个目录
   * @param dir 目录路径
   * @param now 当前时间戳
   * @param depth 当前深度
   */
  private scanDirectory(dir: string, now: number, depth: number): void {
    if (this.config.maxDepth > 0 && depth > this.config.maxDepth) {
      return;
    }

    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      logger.debug('Cannot read directory during discovery', { dir });
      return;
    }

    for (const item of items) {
      const fullPath = path.join(dir, item.name);

      if (item.isDirectory() && this.config.scanRecursive) {
        if (item.name === 'node_modules' || item.name.startsWith('.')) continue;
        this.scanDirectory(fullPath, now, depth + 1);
      } else if (item.isFile()) {
        this.tryDiscoverConfig(fullPath, now);

        if (item.name === 'package.json') {
          this.tryDiscoverNPMConfig(fullPath, now);
        }
      }
    }
  }

  /**
   * 尝试从 MCP 配置文件发现
   * @param filePath 文件路径
   * @param now 当前时间戳
   */
  private tryDiscoverConfig(filePath: string, now: number): void {
    if (path.basename(filePath) !== this.config.configFileName) {
      return;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const config = JSON.parse(content);

      if (config.mcpServers && typeof config.mcpServers === 'object') {
        for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
          const entry = serverConfig as Record<string, unknown>;

          this.discovered.set(name, {
            name,
            path: path.dirname(filePath),
            type: this.inferType(entry),
            command: entry.command as string | undefined,
            args: entry.args as string[] | undefined,
            env: entry.env as Record<string, string> | undefined,
            enabled: entry.enabled !== false,
            discoveredAt: now,
          });
        }
      }
    } catch {
      logger.debug('Failed to parse config file during discovery', { filePath });
    }
  }

  /**
   * 尝试从 NPM package.json 发现
   * @param pkgPath package.json 路径
   * @param now 当前时间戳
   */
  private tryDiscoverNPMConfig(pkgPath: string, now: number): void {
    try {
      const content = fs.readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);

      if (pkg.mcp || pkg.mcpServer) {
        const mcpConfig = pkg.mcp || pkg.mcpServer;
        const name = pkg.name || path.basename(path.dirname(pkgPath));

        this.discovered.set(name, {
          name,
          path: path.dirname(pkgPath),
          type: 'stdio',
          command: mcpConfig.command || 'node',
          args: mcpConfig.args || [pkg.main || 'index.js'],
          env: mcpConfig.env,
          enabled: true,
          discoveredAt: now,
        });
      }
    } catch {
      logger.debug('Failed to parse NPM package.json during discovery', { pkgPath });
    }
  }

  /**
   * 推断 Server 类型
   * @param config Server 配置
   * @returns Server 类型
   */
  private inferType(
    config: Record<string, unknown>
  ): MCPDiscoveryEntry['type'] {
    if (config.url || config.endpoint) return 'http';
    if (config.sseEndpoint || config.sse) return 'sse';
    if (config.command) return 'stdio';

    return 'config';
  }

  /**
   * 获取已发现的 Server 列表
   * @returns 条目列表
   */
  getDiscovered(): MCPDiscoveryEntry[] {
    return Array.from(this.discovered.values());
  }

  /**
   * 获取启用的 Server 列表
   * @returns 条目列表
   */
  getEnabled(): MCPDiscoveryEntry[] {
    return this.getDiscovered().filter((e) => e.enabled);
  }

  /**
   * 添加手动发现的 Server
   * @param entry 条目
   */
  addManual(entry: Omit<MCPDiscoveryEntry, 'discoveredAt'>): void {
    this.discovered.set(entry.name, {
      ...entry,
      discoveredAt: Date.now(),
    });
  }

  /**
   * 移除发现的 Server
   * @param name Server 名称
   */
  remove(name: string): void {
    this.discovered.delete(name);
  }

  /**
   * 获取发现统计
   */
  getStats(): {
    total: number;
    enabled: number;
    byType: Record<string, number>;
  } {
    const all = this.getDiscovered();
    const byType: Record<string, number> = {};

    for (const entry of all) {
      byType[entry.type] = (byType[entry.type] || 0) + 1;
    }

    return {
      total: all.length,
      enabled: all.filter((e) => e.enabled).length,
      byType,
    };
  }

  /**
   * 解析路径（支持 ~ 和相对路径）
   * @param p 路径
   * @returns 绝对路径
   */
  private resolvePath(p: string): string {
    if (p.startsWith('~')) {
      return path.join(
        configManager.env('HOME') || configManager.env('USERPROFILE') || '',
        p.slice(1)
      );
    }

    return path.resolve(p);
  }
}

/**
 * 全局 MCP 自动发现实例
 */
let globalDiscovery: MCPAutoDiscovery | null = null;

/**
 * 获取全局 MCP 自动发现器
 */
export function getMCPAutoDiscovery(): MCPAutoDiscovery {
  if (!globalDiscovery) {
    globalDiscovery = new MCPAutoDiscovery();
  }

  return globalDiscovery;
}
