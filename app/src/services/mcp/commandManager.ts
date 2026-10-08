//
/**
 * 命令管理
 * 负责处理MCP服务器的命令功能
 */

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = getLogger('services:mcp:commandManager');
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
      // 2026-10-08（C-1 连带）：原为 `(client as any).prompts.list()` —— SDK ^1.29.0 的 `Client`
      // **没有 `.prompts` 子对象**（只有顶层 `listPrompts()`）⇒ 恒抛且被下方 catch 吞成 `[]`
      // （MCP 命令静默加载不到）。改用 SDK 顶层方法。
      const { prompts } = await client.listPrompts();
      const commands: McpCommand[] = [];

      for (const prompt of prompts) {
        const command: McpCommand = {
          name: `${serverName}:${prompt.name}`,
          // SDK 的 `description` 可选，而 `McpCommand.description` 必填 ⇒ 缺省补空串
          description: prompt.description ?? '',
          execute: async (args: any) => {
            try {
              // 同族订正：SDK 无 `.prompts.execute()`，取提示的标准方法是 `getPrompt()`
              const result = await client.getPrompt({
                name: prompt.name,
                arguments: args as Record<string, string> | undefined,
              });
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
