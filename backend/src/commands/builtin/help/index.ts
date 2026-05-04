/**
 * 帮助命令
 * 显示帮助信息和可用命令
 */
import type { Command } from '../../types/index.js';
import { getCommandManager } from '../../manager/CommandManager.js';

/**
 * 帮助命令
 */
export const helpCommand: Command = {
  type: 'action',
  name: 'help',
  description: '显示帮助信息和可用命令',
  aliases: ['h', '?'],
  argumentHint: '[command]',
  whenToUse: '当你需要了解如何使用某个命令时',
  load: async () => ({
    execute: async (args: string) => {
      const commandManager = getCommandManager();

      if (args) {
        // 显示特定命令的帮助
        const command = commandManager.getCommand(args);
        if (command) {
          return {
            success: true,
            message: `Command: ${command.name}\nDescription: ${command.description}\n${command.argumentHint ? `Usage: /${command.name} ${command.argumentHint}` : `Usage: /${command.name}`}\n${command.whenToUse ? `When to use: ${command.whenToUse}` : ''}\n${command.aliases ? `Aliases: ${command.aliases.join(', ')}` : ''}`,
          };
        } else {
          return {
            success: false,
            error: `Command not found: ${args}`,
          };
        }
      } else {
        // 显示所有命令
        const commands = commandManager.getAllCommands();
        const commandList = commands
          .filter((cmd) => !cmd.isHidden)
          .map((cmd) => `  /${cmd.name} - ${cmd.description}`)
          .join('\n');

        return {
          success: true,
          message: `Available commands:\n${commandList}\n\nType /help [command] for more information about a specific command.`,
        };
      }
    },
  }),
};

