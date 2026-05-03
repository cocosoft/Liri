// @ts-nocheck
/**
 * 命令管理
 * 负责处理MCP服务器的命令功能
 */

import { logger } from '../../utils/log';
import type { Command } from '../../commands';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

/**
 * 命令管理器
 */
export class CommandManager {
  private commands: Map<string, Command> = new Map();

  /**
   * 从MCP服务器加载命令
   */
  async loadCommandsFromServer(client: Client, serverName: string): Promise<Command[]> {
    try {
      const prompts = await client.prompts.list();
      const commands: Command[] = [];

      for (const prompt of prompts) {
        const command: Command = {
          name: `${serverName}:${prompt.name}`,
          description: prompt.description,
          inputSchema: prompt.inputSchema,
          execute: async (args: any) => {
            try {
              const result = await client.prompts.execute(prompt.name, args);
              return { success: true, data: result };
            } catch (error) {
              logger.error(`Failed to execute command ${prompt.name}:`, error);
              return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
            }
          }
        };

        commands.push(command);
        this.commands.set(command.name, command);
      }

      logger.info(`Loaded ${commands.length} commands from server ${serverName}`);
      return commands;
    } catch (error) {
      logger.error(`Failed to load commands from server ${serverName}:`, error);
      return [];
    }
  }

  /**
   * 获取所有命令
   */
  getCommands(): Command[] {
    return Array.from(this.commands.values());
  }

  /**
   * 获取单个命令
   */
  getCommand(name: string): Command | undefined {
    return this.commands.get(name);
  }

  /**
   * 执行命令
   */
  async executeCommand(name: string, args: any): Promise<{ success: boolean; data?: any; error?: string }> {
    const command = this.commands.get(name);
    if (!command) {
      return { success: false, error: `Command not found: ${name}` };
    }

    try {
      return await command.execute(args);
    } catch (error) {
      logger.error(`Failed to execute command ${name}:`, error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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

    logger.info(`Removed ${commandsToRemove.length} commands from server ${serverName}`);
  }

  /**
   * 清空所有命令
   */
  clear(): void {
    this.commands.clear();
    logger.info('Cleared all commands');
  }
}

// 导出单例
export const commandManager = new CommandManager();

/**
 * 获取命令管理器实例
 */
export function getCommandManager(): CommandManager {
  return commandManager;
}