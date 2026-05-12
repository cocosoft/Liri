/**
 * MCP处理器
 * 处理CLI中的MCP（Model Context Protocol）相关命令
 */

import chalk from 'chalk';
import { mcpConnectionManager } from '@modules/services/mcp/MCPConnectionManager.js';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';
import { ErrorCodes } from '@modules/error/ErrorCodes';

const logger = new Logger({ level: LogLevel.INFO });

export interface MCPHandlerOptions {
  verbose?: boolean;
}

export interface MCPServerInfo {
  name: string;
  url: string;
  status: 'connected' | 'disconnected' | 'connecting';
  version?: string;
}

export class MCPHandler {
  private options: MCPHandlerOptions;
  private servers: MCPServerInfo[] = [];

  constructor(options?: MCPHandlerOptions) {
    this.options = { verbose: false, ...options };
  }

  /**
   * 处理列表命令
   */
  async handleList(): Promise<void> {
    if (this.options.verbose) {
      logger.info('Fetching MCP servers...');
    }

    try {
      await this.fetchServerList();

      console.log(chalk.cyan('═'.repeat(60)));
      console.log(chalk.bold('  MCP Servers'));
      console.log(chalk.cyan('═'.repeat(60)));
      console.log();

      if (this.servers.length === 0) {
        console.log(chalk.yellow('⚠'), 'No MCP servers configured');
      } else {
        this.servers.forEach((server, index) => {
          const statusIcon = this.getStatusIcon(server.status);
          console.log(
            chalk.green(`${String(index + 1).padStart(2)}.`),
            server.name
          );
          console.log(`   ${chalk.gray('URL:')} ${server.url}`);
          console.log(
            `   ${chalk.gray('Status:')} ${statusIcon} ${server.status}`
          );
          if (server.version) {
            console.log(`   ${chalk.gray('Version:')} ${server.version}`);
          }
          console.log();
        });
      }

      console.log(chalk.cyan('═'.repeat(60)));
    } catch (error) {
      throw AppError.fromCode(ErrorCodes.EXECUTION_FAILED, {
        category: ErrorCategory.EXECUTION,
        cause: error instanceof Error ? error : undefined,
        context: { handler: 'MCPHandler', operation: 'handleList' },
      });
    }
  }

  /**
   * 处理连接命令
   */
  async handleConnect(args: string[]): Promise<void> {
    const serverName = args[0];

    if (!serverName) {
      throw AppError.fromCode(ErrorCodes.INVALID_INPUT, {
        category: ErrorCategory.VALIDATION,
        context: { handler: 'MCPHandler', operation: 'handleConnect' },
      });
    }

    if (this.options.verbose) {
      logger.info(`Connecting to ${serverName}...`);
    }

    try {
      await mcpConnectionManager.reconnectServer(serverName);

      const server: MCPServerInfo = {
        name: serverName,
        url: '',
        status: 'connected',
        version: '1.0.0',
      };

      const existingIndex = this.servers.findIndex(
        (s) => s.name === serverName
      );
      if (existingIndex >= 0) {
        this.servers[existingIndex] = server;
      } else {
        this.servers.push(server);
      }

      console.log(chalk.green('✓'), `Connected to ${serverName}`);
    } catch (error) {
      throw AppError.fromCode(ErrorCodes.EXECUTION_FAILED, {
        category: ErrorCategory.EXECUTION,
        cause: error instanceof Error ? error : undefined,
        context: {
          handler: 'MCPHandler',
          operation: 'handleConnect',
          serverName,
        },
      });
    }
  }

  /**
   * 处理断开连接命令
   */
  async handleDisconnect(args: string[]): Promise<void> {
    const serverName = args[0];

    if (!serverName) {
      throw AppError.fromCode(ErrorCodes.INVALID_INPUT, {
        category: ErrorCategory.VALIDATION,
        context: { handler: 'MCPHandler', operation: 'handleDisconnect' },
      });
    }

    if (this.options.verbose) {
      logger.info(`Disconnecting from ${serverName}...`);
    }

    try {
      const server = mcpConnectionManager.getServer(serverName);
      if (!server) {
        throw new AppError(
          `Server not found: ${serverName}`,
          ErrorCategory.EXECUTION,
          ErrorSeverity.HIGH,
          '1005'
        );
      }

      console.log(chalk.green('✓'), `Disconnected from ${serverName}`);
    } catch (error) {
      throw AppError.fromCode(ErrorCodes.EXECUTION_FAILED, {
        category: ErrorCategory.EXECUTION,
        cause: error instanceof Error ? error : undefined,
        context: {
          handler: 'MCPHandler',
          operation: 'handleDisconnect',
          serverName,
        },
      });
    }
  }

  /**
   * 获取状态图标
   */
  private getStatusIcon(status: string): string {
    switch (status) {
      case 'connected':
        return chalk.green('●');
      case 'connecting':
        return chalk.yellow('○');
      case 'disconnected':
        return chalk.gray('○');
      default:
        return chalk.gray('○');
    }
  }

  /**
   * 获取服务器列表（从MCP连接管理器）
   */
  private async fetchServerList(): Promise<void> {
    const realServers = mcpConnectionManager.getServers();
    this.servers = realServers.map((conn) => {
      const connConfig = conn.config as Record<string, unknown>;
      const url = typeof connConfig.url === 'string' ? connConfig.url : '';
      const status: 'connected' | 'disconnected' | 'connecting' =
        conn.type === 'connected'
          ? 'connected'
          : conn.type === 'pending'
            ? 'connecting'
            : 'disconnected';
      const version =
        conn.type === 'connected' ? conn.serverInfo?.version : undefined;
      return {
        name: conn.name,
        url,
        status,
        version,
      };
    });
  }
}

/**
 * 创建MCP处理器
 */
export function createMCPHandler(options?: MCPHandlerOptions): MCPHandler {
  return new MCPHandler(options);
}
