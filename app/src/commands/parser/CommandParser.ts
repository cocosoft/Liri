//
/**
 * 命令解析器
 * 使用Commander.js实现命令解析和子命令系统
 */
import { Command as CommanderCommand, Option } from 'commander';
import type { CommandContext, CommandResult } from '@modules/commands/types';
import { getCommandManager } from '@modules/commands/manager/CommandManager.js';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 命令解析器类
 */
export class CommandParser {
  /**
   * Commander.js实例
   */
  private program: CommanderCommand;

  /**
   * 命令管理器（懒加载，避免循环依赖）
   */
  private get commandManager() {
    return getCommandManager();
  }

  /**
   * 构造函数
   */
  constructor() {
    this.program = new CommanderCommand();
    this.program
      .name('Liri')
      .description('基于TypeScript + Rust架构的AI Agent项目')
      .version('1.0.0');
  }

  /**
   * 注册命令到Commander.js
   * @param command 命令对象
   */
  registerCommand(command: any): void {
    const cmd = this.program
      .command(command.name)
      .description(command.description || '')
      .action(async (args: any[], options: any) => {
        await this.executeCommand(command.name, args.join(' '), options);
      });

    // 添加命令选项
    if (command.options) {
      for (const option of command.options) {
        const opt = new Option(option.flags, option.description || '');
        if (option.required) {
          opt.required = true;
        }
        if (option.default !== undefined) {
          opt.default = option.default;
        }
        cmd.addOption(opt);
      }
    }

    // 添加子命令
    if (command.subcommands) {
      for (const subcommand of command.subcommands) {
        this.registerSubcommand(cmd, subcommand);
      }
    }
  }

  /**
   * 注册子命令
   * @param parentCommand 父命令
   * @param subcommand 子命令
   */
  private registerSubcommand(
    parentCommand: CommanderCommand,
    subcommand: any
  ): void {
    const cmd = parentCommand
      .command(subcommand.name)
      .description(subcommand.description || '')
      .action(async (args: any[], options: any) => {
        const fullCommandName = `${parentCommand.name()} ${subcommand.name}`;
        await this.executeCommand(fullCommandName, args.join(' '), options);
      });

    // 添加子命令选项
    if (subcommand.options) {
      for (const option of subcommand.options) {
        const opt = new Option(option.flags, option.description || '');
        if (option.required) {
          opt.required = true;
        }
        if (option.default !== undefined) {
          opt.default = option.default;
        }
        cmd.addOption(opt);
      }
    }

    // 递归添加子命令
    if (subcommand.subcommands) {
      for (const subsubcommand of subcommand.subcommands) {
        this.registerSubcommand(cmd, subsubcommand);
      }
    }
  }

  /**
   * 执行命令
   * @param commandName 命令名
   * @param args 命令参数
   * @param options 命令选项
   */
  private async executeCommand(
    commandName: string,
    args: string,
    options: any
  ): Promise<void> {
    const context: CommandContext = {
      options,
    };

    const result = await this.commandManager.executeCommand(
      commandName,
      args,
      context
    );
    if (!result.success && result.error) {
      logger.error(`Error: ${result.error}`);
    }
  }

  /**
   * 解析命令行参数
   * @param args 命令行参数
   */
  parse(args: string[]): void {
    try {
      this.program.parse(args);
    } catch (error) {
      logger.error(
        `Error parsing command`,
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  /**
   * 生成命令帮助文本
   * @returns 帮助文本
   */
  generateHelp(): string {
    return this.program.helpInformation();
  }

  /**
   * 获取Commander.js实例
   * @returns Commander.js实例
   */
  getProgram(): CommanderCommand {
    return this.program;
  }
}

/**
 * 命令解析器实例
 */
let commandParser: CommandParser | undefined;

/**
 * 获取命令解析器实例
 * @returns 命令解析器实例
 */
export function getCommandParser(): CommandParser {
  if (!commandParser) {
    commandParser = new CommandParser();
  }
  return commandParser;
}

/**
 * 初始化命令解析器
 * @returns 命令解析器实例
 */
export async function initializeCommandParser(): Promise<CommandParser> {
  const parser = getCommandParser();
  const commands = getCommandManager().getAllCommands();

  // 注册所有命令
  for (const command of commands) {
    parser.registerCommand(command);
  }

  return parser;
}
