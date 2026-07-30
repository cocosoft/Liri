//
/**
 * 命令管理
 * 负责处理MCP服务器的命令功能
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = new Logger({
  module: 'services:mcp:commandManager',
  level: LogLevel.INFO,
});
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

/**
 * MCP命令接口
 */
export interface McpCommand {
  name: string;
  description: string;
  execute: (
    args: any
  ) => Promise<{ success: boolean; data?: any; error?: string }>;
}

/**
 * 命令管理器
 */
export class CommandManager {
  private commands: Map<string, McpCommand> = new Map();

  /**
   * 从MCP服务器加载命令
   */
  async loadCommandsFromServer(
    client: Client,
    serverName: string
  ): Promise<McpCommand[]> {
    try {
      const prompts = await (client as any).prompts.list();
      const commands: McpCommand[] = [];

      for (const prompt of prompts) {
        const command: McpCommand = {
          name: `${serverName}:${prompt.name}`,
          description: prompt.description,
          execute: async (args: any) => {
            try {
              const result = await (client as any).prompts.execute(
                prompt.name,
                args
              );
              return { success: true, data: result };
            } catch (error) {
              handleError(error, {
                module: 'services:mcp:command',
                action: '执行命令失败',
              });
              return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
              };
            }
          },
        };

        commands.push(command);
        this.commands.set(command.name, command);
      }

      logger.info(
        `Loaded ${commands.length} commands from server ${serverName}`
      );
      return commands;
    } catch (error) {
      handleError(error, {
        module: 'services:mcp:command',
        action: '从服务器加载命令失败',
      });
      return [];
    }
  }

  /**
   * 获取所有命令
   */
  getCommands(): McpCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * 获取单个命令
   */
  getCommand(name: string): McpCommand | undefined {
    return this.commands.get(name);
  }

  /**
   * 执行命令
   */
  async executeCommand(
    name: string,
    args: any
  ): Promise<{ success: boolean; data?: any; error?: string }> {
    const command = this.commands.get(name);
    if (!command) {
      return { success: false, error: `Command not found: ${name}` };
    }

    try {
      return await command.execute(args);
    } catch (error) {
      handleError(error, {
        module: 'services:mcp:command',
        action: 'executeCommand失败',
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * 移除服务器的所有命令
   */
  removeServerCommands(serverName: string): void {
    const commandsToRemove: string[] = [];
    for (const [name] of this.commands) {
      if (name.startsWith(`${serverName}:`)) {
        commandsToRemove.push(name);
      }
    }

    for (const name of commandsToRemove) {
      this.commands.delete(name);
    }

    logger.info(
      `Removed ${commandsToRemove.length} commands from server ${serverName}`
    );
  }

  /**
   * 清除所有命令
   */
  clear(): void {
    this.commands.clear();
    logger.info('All commands cleared');
  }
}

const commandManager = new CommandManager();

export function getCommandManager(): CommandManager {
  return commandManager;
}
