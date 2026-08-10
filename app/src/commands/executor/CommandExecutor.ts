/**
 * 命令执行器
 * 处理命令字符串解析和执行
 */
import type {
  CommandContext,
  CommandResult,
  ParsedCommand,
} from '@modules/commands';
import { getCommandManager } from '@modules/commands';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('commands:executor:CommandExecutor');

/**
 * 命令中间件类型
 */
export type CommandMiddleware = (
  command: string,
  context: CommandContext,
  next: () => Promise<CommandResult>
) => Promise<CommandResult>;

/**
 * 命令执行器配置
 */
export interface CommandExecutorConfig {
  timeout?: number;
  enableOptions?: boolean;
}

/**
 * 命令执行器类
 */
export class CommandExecutor {
  private commandManager = getCommandManager();
  private timeout: number;
  private enableOptions: boolean;

  constructor(config: CommandExecutorConfig = {}) {
    this.timeout = config.timeout || 30000;
    this.enableOptions = config.enableOptions ?? true;
  }

  /**
   * 执行命令
   */
  async execute(
    commandString: string,
    context: CommandContext = {}
  ): Promise<CommandResult> {
    const { name, args } = this.parseCommandString(commandString);

    if (!name) {
      return {
        success: false,
        error: 'No command specified',
      };
    }

    return await this.commandManager.executeCommand(name, args, context);
  }

  /**
   * 执行命令（带选项支持）
   */
  async executeWithOptions(
    commandString: string,
    context: CommandContext = {},
    options?: Record<string, string | boolean | number>
  ): Promise<CommandResult> {
    const { name, args } = this.parseCommandString(commandString);

    if (!name) {
      return {
        success: false,
        error: 'No command specified',
      };
    }

    // 构建带选项的完整参数
    let fullArgs = args;
    if (options && this.enableOptions) {
      const optionParts: string[] = [];
      for (const [key, value] of Object.entries(options)) {
        if (typeof value === 'string') {
          optionParts.push(`--${key}`, value);
        } else if (value === true) {
          optionParts.push(`--${key}`);
        }
      }
      if (optionParts.length > 0) {
        fullArgs = args
          ? `${args} ${optionParts.join(' ')}`
          : optionParts.join(' ');
      }
    }

    return await this.commandManager.executeCommand(name, fullArgs, context);
  }

  /**
   * 执行已解析的命令
   */
  async executeParsed(
    parsed: ParsedCommand,
    context: CommandContext = {}
  ): Promise<CommandResult> {
    const { name, args, options } = parsed;

    if (!name) {
      return {
        success: false,
        error: 'No command specified',
      };
    }

    // 构建带选项的完整参数
    let fullArgs = args;
    if (options && Object.keys(options).length > 0 && this.enableOptions) {
      const optionParts: string[] = [];
      for (const [key, value] of Object.entries(options)) {
        if (typeof value === 'string') {
          optionParts.push(`--${key}`, value);
        } else if (value === true) {
          optionParts.push(`--${key}`);
        }
      }
      if (optionParts.length > 0) {
        fullArgs = args.length > 0 ? [...args, ...optionParts] : optionParts;
      }
    }

    return await this.commandManager.executeCommand(
      name,
      fullArgs.join(' '),
      context
    );
  }

  /**
   * 执行命令（带超时支持）
   */
  async executeWithTimeout(
    commandString: string,
    context: CommandContext = {},
    timeout?: number
  ): Promise<CommandResult> {
    const timeoutMs = timeout || this.timeout;

    try {
      const result = await Promise.race([
        this.execute(commandString, context),
        this.createTimeout(timeoutMs),
      ]);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * 解析命令字符串
   */
  private parseCommandString(commandString: string): {
    name: string;
    args: string;
  } {
    const cleaned = commandString.replace(/^\s*\//, '');
    const parts = cleaned.split(/\s+/);
    const name = parts[0] || '';
    const args = parts.slice(1).join(' ');

    return { name, args };
  }

  /**
   * 创建超时 Promise
   */
  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error(`Command execution timeout (${ms}ms)`)),
        ms
      );
    });
  }

  /**
   * 检查是否是命令
   */
  isCommand(input: string): boolean {
    return input.trim().startsWith('/');
  }

  /**
   * 获取命令名
   */
  getCommandName(input: string): string {
    const { name } = this.parseCommandString(input);
    return name;
  }

  /**
   * 验证命令
   */
  isValidCommand(commandName: string): boolean {
    return this.commandManager.hasCommand(commandName);
  }
}

/**
 * 创建命令执行器实例
 */
export function createCommandExecutor(
  config?: CommandExecutorConfig
): CommandExecutor {
  return new CommandExecutor(config);
}

/**
 * 命令执行器实例（使用 Proxy 懒加载，避免循环依赖导致 TDZ）
 */
let _commandExecutor: CommandExecutor | undefined;

export function getCommandExecutor(
  config?: CommandExecutorConfig
): CommandExecutor {
  if (!_commandExecutor) {
    _commandExecutor = new CommandExecutor(config);
  }
  return _commandExecutor;
}

export const commandExecutor = new Proxy({} as CommandExecutor, {
  get(_, prop: keyof CommandExecutor) {
    const instance = getCommandExecutor();
    const value = instance[prop];
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  },
  set(_, prop: keyof CommandExecutor, value) {
    (getCommandExecutor() as any)[prop] = value;
    return true;
  },
});
