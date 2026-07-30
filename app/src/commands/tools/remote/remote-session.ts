/**
 * 远程会话CLI命令处理器
 * 提供SSH和直接连接的命令行接口
 */

import { TerminalUIIntegration } from '@modules/ui/TerminalUIIntegration.js';
import { configManager } from '@modules/config';
import {
  RemoteSessionManager,
  RemoteSessionConfig,
  createRemoteSessionConfig,
} from '@modules/remote/RemoteSessionManager.js';
import { SSHConfig } from '@modules/remote/SSHConnection.js';
import { TerminalComponents } from '@modules/ui/TerminalComponents.js';
import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'RemoteSession' });
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

/**
 * 获取模型提示词（供 AI 理解远程会话能力）
 */
function getPromptForCommand(): string {
  return [
    '- Remote Session: 管理远程连接会话',
    '  - SSH连接: connect ssh <host> [--port 22] [--username user] [--key path]',
    '  - 直接连接: connect direct <url>',
    '  - 关闭会话: close <sessionId>',
    '  - 远程执行: exec <sessionId> <command>',
    '  - 查看会话: sessions',
  ].join('\n');
}

/**
 * CLI命令结果
 */
export interface CLICommandResult {
  success: boolean;
  output?: string;
  error?: string;
}

/**
 * 远程会话CLI命令处理器
 */
export class RemoteSessionCLI {
  private terminalUI: TerminalUIIntegration;
  private sessions: Map<string, RemoteSessionManager> = new Map();

  constructor(terminalUI?: TerminalUIIntegration) {
    this.terminalUI = terminalUI || TerminalUIIntegration.getInstance();
  }

  /**
   * 解析SSH连接命令
   * 格式: connect ssh <host> [--port 22] [--username user] [--key path]
   */
  async handleSSHConnect(args: string[]): Promise<CLICommandResult> {
    try {
      const hostIndex = args.findIndex(
        (arg) => arg !== 'ssh' && !arg.startsWith('--')
      );
      if (hostIndex === -1) {
        return {
          success: false,
          error: '请指定SSH主机地址，例如: connect ssh example.com',
        };
      }

      const host = args[hostIndex];
      const options = this.parseOptions(args.slice(hostIndex + 1));

      const sshConfig: SSHConfig = {
        host,
        port: options.port ? parseInt(options.port, 10) : 22,
        username: options.username || configManager.env('USER') || 'root',
        privateKey: options.key,
      };

      const sessionId = `ssh-${Date.now()}`;
      this.terminalUI.createSession(sessionId, 'ssh', sshConfig);

      await TerminalComponents.printSpinner(
        `正在连接到 ${host}...`,
        async () => {
          const config = createRemoteSessionConfig(sessionId, {
            sshConfig,
          });

          const callbacks = {
            onMessage: (message: unknown) => {
              logger.debug('Received message:', message);
            },
            onConnected: () => {
              this.terminalUI.updateSessionStatus(sessionId, 'connected');
            },
            onDisconnected: () => {
              this.terminalUI.updateSessionStatus(sessionId, 'disconnected');
            },
            onError: (error: Error) => {
              this.terminalUI.updateSessionStatus(
                sessionId,
                'error',
                error.message
              );
            },
          };

          const manager = new RemoteSessionManager(config, callbacks);
          const success = await manager.connect();

          if (!success) {
            throw new AppError(
              'SSH连接失败',
              ErrorCategory.EXECUTION,
              ErrorSeverity.HIGH,
              '1000'
            );
          }

          this.sessions.set(sessionId, manager);
        }
      );

      return {
        success: true,
        output: `SSH会话已连接，会话ID: ${sessionId}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 解析直接连接命令
   * 格式: connect direct <url>
   */
  async handleDirectConnect(args: string[]): Promise<CLICommandResult> {
    try {
      const urlIndex = args.findIndex(
        (arg) => arg !== 'direct' && !arg.startsWith('--')
      );
      if (urlIndex === -1) {
        return {
          success: false,
          error: '请指定连接URL，例如: connect direct cc://token@example.com',
        };
      }

      const url = args[urlIndex];
      const sessionId = `direct-${Date.now()}`;
      this.terminalUI.createSession(sessionId, 'direct_connect', { url });

      await TerminalComponents.printSpinner(
        `正在连接到 ${url}...`,
        async () => {
          const config = createRemoteSessionConfig(sessionId, {
            directConnectUrl: url,
          });

          const callbacks = {
            onMessage: (message: unknown) => {
              logger.debug('Received message:', message);
            },
            onConnected: () => {
              this.terminalUI.updateSessionStatus(sessionId, 'connected');
            },
            onDisconnected: () => {
              this.terminalUI.updateSessionStatus(sessionId, 'disconnected');
            },
            onError: (error: Error) => {
              this.terminalUI.updateSessionStatus(
                sessionId,
                'error',
                error.message
              );
            },
          };

          const manager = new RemoteSessionManager(config, callbacks);
          const success = await manager.connect();

          if (!success) {
            throw new AppError(
              '直接连接失败',
              ErrorCategory.EXECUTION,
              ErrorSeverity.HIGH,
              '1000'
            );
          }

          this.sessions.set(sessionId, manager);
        }
      );

      return {
        success: true,
        output: `直接连接已建立，会话ID: ${sessionId}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 处理关闭会话命令
   * 格式: close <sessionId>
   */
  handleCloseSession(args: string[]): CLICommandResult {
    const sessionId = args[0];
    if (!sessionId) {
      return {
        success: false,
        error: '请指定要关闭的会话ID',
      };
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        error: `未找到会话: ${sessionId}`,
      };
    }

    session.disconnect();
    this.sessions.delete(sessionId);
    this.terminalUI.closeSession(sessionId);

    return {
      success: true,
      output: `会话 ${sessionId} 已关闭`,
    };
  }

  /**
   * 处理在远程会话中执行命令
   * 格式: exec <sessionId> <command>
   */
  async handleRemoteExec(args: string[]): Promise<CLICommandResult> {
    const sessionId = args[0];
    const command = args.slice(1).join(' ');

    if (!sessionId) {
      return {
        success: false,
        error: '请指定会话ID',
      };
    }

    if (!command) {
      return {
        success: false,
        error: '请指定要执行的命令',
      };
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        success: false,
        error: `未找到会话: ${sessionId}`,
      };
    }

    try {
      const success = await session.sendMessage({
        type: 'command',
        content: command,
      });

      return {
        success,
        output: success ? `命令已发送到会话 ${sessionId}` : '命令发送失败',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 解析命令行选项
   */
  private parseOptions(args: string[]): Record<string, string> {
    const options: Record<string, string> = {};

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('--')) {
        const key = arg.slice(2);
        const value = args[i + 1];
        if (value && !value.startsWith('--')) {
          options[key] = value;
          i++;
        } else {
          options[key] = 'true';
        }
      }
    }

    return options;
  }

  /**
   * 显示远程会话帮助
   */
  showHelp(): void {
    TerminalComponents.printHeader('远程会话命令');

    const commands = [
      { cmd: 'connect ssh <host>', desc: '连接SSH会话' },
      {
        cmd: 'connect ssh <host> --port 22 --username user --key /path/to/key',
        desc: '带选项的SSH连接',
      },
      { cmd: 'connect direct <url>', desc: '连接直接连接会话' },
      { cmd: 'close <sessionId>', desc: '关闭指定会话' },
      { cmd: 'exec <sessionId> <command>', desc: '在远程会话中执行命令' },
      { cmd: 'sessions', desc: '显示所有会话列表' },
    ];

    TerminalComponents.printList(
      commands.map((c) => `${c.cmd} - ${c.desc}`),
      { bullet: '►' }
    );
  }

  /**
   * 获取所有活动会话
   */
  getActiveSessions(): Array<{
    id: string;
    type: string;
    isConnected: boolean;
  }> {
    return Array.from(this.sessions.entries()).map(([id, manager]) => ({
      id,
      type: manager['sessionType'],
      isConnected: manager.isConnected(),
    }));
  }

  /**
   * 关闭所有会话
   */
  closeAllSessions(): void {
    for (const [id, session] of this.sessions) {
      session.disconnect();
      this.terminalUI.closeSession(id);
    }
    this.sessions.clear();
  }
}

/**
 * 创建远程会话CLI处理器
 */
export { getPromptForCommand };

export function createRemoteSessionCLI(
  terminalUI?: TerminalUIIntegration
): RemoteSessionCLI {
  return new RemoteSessionCLI(terminalUI);
}
