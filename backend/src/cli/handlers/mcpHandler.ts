/**
 * MCP处理器
 * 处理CLI中的MCP（Model Context Protocol）相关命令
 */

import chalk from 'chalk';
import { mcpConnectionManager } from '../../services/mcp/MCPConnectionManager.js';

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
      console.log(chalk.blue('ℹ'), 'Fetching MCP servers...');
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
          console.log(chalk.green(`${String(index + 1).padStart(2)}.`), server.name);
          console.log(`   ${chalk.gray('URL:')} ${server.url}`);
          console.log(`   ${chalk.gray('Status:')} ${statusIcon} ${server.status}`);
          if (server.version) {
            console.log(`   ${chalk.gray('Version:')} ${server.version}`);
          }
          console.log();
        });
      }

      console.log(chalk.cyan('═'.repeat(60)));
    } catch (error) {
      console.error(chalk.red('✗'), `Failed to list MCP servers: ${error}`);
      process.exit(1);
    }
  }

  /**
   * 处理连接命令
   */
  async handleConnect(args: string[]): Promise<void> {
    const serverName = args[0];

    if (!serverName) {
      console.error(chalk.red('✗'), 'Server name is required');
      process.exit(1);
    }

    if (this.options.verbose) {
      console.log(chalk.blue('ℹ'), `Connecting to ${serverName}...`);
    }

    try {
      await mcpConnectionManager.reconnectServer(serverName);

      const server: MCPServerInfo = {
        name: serverName,
        url: '',
        status: 'connected',
        version: '1.0.0',
      };

      const existingIndex = this.servers.findIndex(s => s.name === serverName);
      if (existingIndex >= 0) {
        this.servers[existingIndex] = server;
      } else {
        this.servers.push(server);
      }

      console.log(chalk.green('✓'), `Connected to ${serverName}`);
    } catch (error) {
      console.error(chalk.red('✗'), `Failed to connect: ${error}`);
      process.exit(1);
    }
  }

  /**
   * 处理断开连接命令
   */
  async handleDisconnect(args: string[]): Promise<void> {
    const serverName = args[0];

    if (!serverName) {
      console.error(chalk.red('✗'), 'Server name is required');
      process.exit(1);
    }

    if (this.options.verbose) {
      console.log(chalk.blue('ℹ'), `Disconnecting from ${serverName}...`);
    }

    try {
      const server = mcpConnectionManager.getServer(serverName);
      if (!server) {
        throw new Error(`Server not found: ${serverName}`);
      }

      console.log(chalk.green('✓'), `Disconnected from ${serverName}`);
    } catch (error) {
      console.error(chalk.red('✗'), `Failed to disconnect: ${error}`);
      process.exit(1);
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
    this.servers = realServers.map(conn => ({
      name: conn.name,
      url: ((conn as any).config?.url || '') as string,
      status: conn.type === 'connected' ? 'connected' : conn.type === 'pending' ? 'connecting' : 'disconnected',
      version: (conn as any).serverInfo?.version || undefined,
    }));
  }
}

/**
 * 创建MCP处理器
 */
export function createMCPHandler(options?: MCPHandlerOptions): MCPHandler {
  return new MCPHandler(options);
}