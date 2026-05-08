//
/**
 * 命令管理器
 * 处理命令执行和管理
 */
import type { Command, CommandContext, CommandResult } from '@modules/commands/types';
import { commandRegistry } from '@modules/commands/registry/CommandRegistry.js';
import { commandLoaderRegistry } from '@modules/commands/loader/CommandLoader.js';
import { getCommandParser } from '@modules/commands/parser/CommandParser.js';
import { REMOTE_SAFE_COMMANDS, BRIDGE_SAFE_COMMANDS } from '@modules/commands/constants/CommandConstants.js';

/**
 * 命令管理器类
 */
export class CommandManager {
  /**
   * 命令注册表
   */
  private registry: typeof commandRegistry;

  /**
   * 命令加载器注册表
   */
  private loaderRegistry: typeof commandLoaderRegistry;

  /**
   * 命令实现缓存
   */
  private commandImplementationCache: Map<string, any> = new Map();

  /**
   * 命令解析器（懒加载，避免循环依赖）
   */
  private get parser() {
    return getCommandParser();
  }

  /**
   * 构造函数
   * @param registry 命令注册表
   * @param loaderRegistry 命令加载器注册表
   */
  constructor(
    registry: typeof commandRegistry,
    loaderRegistry: typeof commandLoaderRegistry
  ) {
    this.registry = registry;
    this.loaderRegistry = loaderRegistry;
  }

  /**
   * 初始化命令系统
   */
  async initialize(): Promise<void> {
    console.log('Initializing command system...');

    try {
      // 加载所有命令
      const commands = await this.loaderRegistry.loadAllCommands();

      // 注册命令
      let registeredCount = 0;
      for (const command of commands) {
        if (command && command.name) {
          this.registry.register(command);
          try {
            this.parser.registerCommand(command);
          } catch {
            // Commander.js 可能因重复注册抛出异常，不影响其他命令注册
          }
          registeredCount++;
        }
      }

      console.log(`Loaded ${registeredCount} commands`);
    } catch (error) {
      console.error('Failed to initialize command system:', error);
    }

    console.log('Command system initialized successfully');
  }

  /**
   * 执行命令
   * @param name 命令名
   * @param args 命令参数
   * @param context 命令上下文
   * @returns 命令执行结果
   */
  async executeCommand(
    name: string,
    args: string,
    context: CommandContext = {}
  ): Promise<CommandResult> {
    const command = this.registry.getCommand(name);
    if (!command) {
      return {
        success: false,
        error: `Command not found: ${name}`,
      };
    }

    // 检查命令是否启用（来自CC源码）
    if (!this.isCommandEnabled(command)) {
      return {
        success: false,
        error: `Command ${name} is not enabled`,
      };
    }

    // 检查命令是否满足可用性要求（来自CC源码）
    if (!this.meetsAvailabilityRequirement(command)) {
      return {
        success: false,
        error: `Command ${name} is not available in current environment`,
      };
    }

    try {
      // 加载命令实现（使用缓存）
      let implementation: any = {};
      if (command.load) {
        // 检查缓存
        if (this.commandImplementationCache.has(command.name)) {
          implementation = this.commandImplementationCache.get(command.name);
        } else {
          // 加载并缓存
          implementation = await command.load();
          this.commandImplementationCache.set(command.name, implementation);
        }
      }

      // 执行命令
      if (typeof implementation === 'object' && implementation !== null && implementation.execute) {
        // 使用 bind 确保 this 正确绑定到实例
        return await implementation.execute.bind(implementation)(args, context);
      } else if (typeof implementation === 'object' && implementation !== null && implementation.call) {
        // 支持 call 方法作为 execute 的别名
        const result = await implementation.call.bind(implementation)(args, context);
        return {
          success: true,
          data: result,
        };
      } else if (typeof implementation === 'object' && implementation !== null && implementation.getPromptForCommand) {
        // 对于prompt类型命令，返回提示
        const prompt = implementation.getPromptForCommand.bind(implementation)(args);
        return {
          success: true,
          data: { prompt },
        };
      } else {
        return {
          success: false,
          error: `Command ${name} has no implementation`,
        };
      }
    } catch (error) {
      console.error(`Failed to execute command ${name}:`, error);
      return {
        success: false,
        error: `Failed to execute command: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 解析命令行参数
   * @param args 命令行参数
   */
  parse(args: string[]): void {
    this.parser.parse(args);
  }

  /**
   * 生成命令帮助文本
   * @returns 帮助文本
   */
  generateHelp(): string {
    return this.parser.generateHelp();
  }

  /**
   * 获取命令
   * @param name 命令名
   * @returns 命令对象或undefined
   */
  getCommand(name: string): Command | undefined {
    return this.registry.getCommand(name);
  }

  /**
   * 获取所有命令
   * @returns 命令列表
   */
  getAllCommands(): Command[] {
    return this.registry.getAllCommands();
  }

  /**
   * 根据类型获取命令
   * @param type 命令类型
   * @returns 命令列表
   */
  getCommandsByType(type: Command['type']): Command[] {
    return this.registry.getCommandsByType(type);
  }

  /**
   * 根据来源获取命令
   * @param source 命令来源
   * @returns 命令列表
   */
  getCommandsBySource(source: string): Command[] {
    return this.registry.getCommandsBySource(source);
  }

  /**
   * 重新加载命令
   */
  async reloadCommands(): Promise<void> {
    // 清空注册表
    this.registry.clear();
    // 清空缓存
    this.clearCache();
    // 重新加载命令
    await this.initialize();
  }

  /**
   * 清除命令实现缓存
   */
  clearCache(): void {
    this.commandImplementationCache.clear();
  }

  /**
   * 获取命令数量
   * @returns 命令数量
   */
  getCommandCount(): number {
    return this.registry.getCommandCount();
  }

  /**
   * 检查命令是否存在
   * @param name 命令名
   * @returns 是否存在
   */
  hasCommand(name: string): boolean {
    return this.registry.hasCommand(name);
  }

  /**
   * 检查命令是否启用（来自CC源码）
   * @param command 命令对象
   * @returns 是否启用
   */
  isCommandEnabled(command: Command): boolean {
    if (command.isEnabled) {
      return command.isEnabled();
    }
    return true;
  }

  /**
   * 检查命令是否满足可用性要求（来自CC源码）
   * @param command 命令对象
   * @returns 是否满足可用性要求
   */
  meetsAvailabilityRequirement(command: Command): boolean {
    if (!command.availability) return true;
    
    // 检查auth/provider状态（简化实现，后续可根据实际需求扩展）
    for (const a of command.availability) {
      switch (a) {
        case 'claude-ai':
          // 检查Claude AI可用性
          return this.checkClaudeAIAvailability();
        case 'console':
          // 检查控制台可用性
          return this.checkConsoleAvailability();
        case 'desktop':
          // 检查桌面应用可用性
          return this.checkDesktopAvailability();
        case 'mobile':
          // 检查移动端可用性
          return this.checkMobileAvailability();
        case 'bridge':
          // 检查Bridge模式可用性
          return this.checkBridgeAvailability();
        default:
          // 未知的可用性要求，默认返回false
          return false;
      }
    }
    return false;
  }

  /**
   * 检查Claude AI可用性（简化实现）
   */
  private checkClaudeAIAvailability(): boolean {
    // 简化实现，实际应根据环境变量或配置检查
    return process.env.CLAUDE_AI_ENABLED === 'true';
  }

  /**
   * 检查控制台可用性（简化实现）
   */
  private checkConsoleAvailability(): boolean {
    // 控制台模式通常可用
    return true;
  }

  /**
   * 检查桌面应用可用性（简化实现）
   */
  private checkDesktopAvailability(): boolean {
    // 检查是否在桌面环境中运行
    return process.env.DESKTOP_ENV === 'true' || typeof window !== 'undefined';
  }

  /**
   * 检查移动端可用性（简化实现）
   */
  private checkMobileAvailability(): boolean {
    // 检查是否在移动端环境中运行
    return process.env.MOBILE_ENV === 'true' || 
           (typeof navigator !== 'undefined' && /mobile/i.test(navigator.userAgent));
  }

  /**
   * 检查Bridge模式可用性（简化实现）
   */
  private checkBridgeAvailability(): boolean {
    // 检查Bridge模式是否启用
    return process.env.BRIDGE_MODE === 'true';
  }

  /**
   * 过滤远程安全命令（来自CC源码）
   * @param commands 命令列表
   * @returns 远程安全命令列表
   */
  filterCommandsForRemoteMode(commands: Command[]): Command[] {
    return commands.filter(command => 
      REMOTE_SAFE_COMMANDS.has(command.name)
    );
  }

  /**
   * 检查命令是否为Bridge安全命令（来自CC源码）
   * @param command 命令对象
   * @returns 是否为Bridge安全命令
   */
  isBridgeSafeCommand(command: Command): boolean {
    return BRIDGE_SAFE_COMMANDS.has(command.name);
  }

  /**
   * 清除命令缓存（来自CC源码）
   */
  clearCommandsCache(): void {
    this.clearCache();
    // 清除技能缓存（如果有）
    // 清除插件命令缓存（如果有）
    console.log('Command cache cleared');
  }

  /**
   * 搜索命令
   * 基于关键词搜索命令名称、描述、别名等
   * 参考CC源码工具搜索实现
   *
   * @param query 搜索关键词
   * @param options 搜索选项
   * @returns 匹配的命令列表
   */
  searchCommands(
    query: string,
    options: {
      limit?: number;
      searchFields?: ('name' | 'description' | 'aliases' | 'whenToUse' | 'argumentHint')[];
      includeHidden?: boolean;
    } = {}
  ): { command: Command; relevance: number }[] {
    return this.registry.searchCommands(query, options);
  }

  /**
   * 获取命令统计信息
   * @returns 命令统计信息
   */
  getCommandStats(): ReturnType<CommandRegistry['getCommandStats']> {
    return this.registry.getCommandStats();
  }

  /**
   * 获取加载状态
   * @returns 加载状态信息
   */
  getLoadStatus(): { loaded: string[]; failed: { name: string; error: string }[] } {
    const status = this.loaderRegistry.getLoadStatus();
    const allCommands = this.registry.getAllCommands();
    return {
      loaded: allCommands.map(c => c.name),
      failed: status.failed,
    };
  }

  /**
   * 获取命令补全建议
   * @param partial 部分输入
   * @returns 补全建议列表
   */
  getCompletions(partial: string): string[] {
    if (!partial.startsWith('/')) {
      return [];
    }

    const partialName = partial.slice(1).toLowerCase();
    const suggestions: string[] = [];

    for (const cmd of this.registry.getVisible()) {
      if (cmd.name.toLowerCase().startsWith(partialName)) {
        suggestions.push(`/${cmd.name}`);
      }

      if (cmd.aliases) {
        for (const alias of cmd.aliases) {
          if (alias.toLowerCase().startsWith(partialName)) {
            suggestions.push(`/${alias}`);
          }
        }
      }
    }

    return suggestions;
  }
}

/**
 * 命令管理器实例（使用 Symbol 存储在全局对象中，防止模块重复加载导致实例丢失）
 */
const COMMAND_MANAGER_SYMBOL = Symbol.for('PY_APP_COMMAND_MANAGER');

/**
 * 获取命令管理器实例
 * @returns 命令管理器实例
 */
export function getCommandManager(): CommandManager {
  const globalObj = globalThis as any;
  
  if (!globalObj[COMMAND_MANAGER_SYMBOL]) {
    globalObj[COMMAND_MANAGER_SYMBOL] = new CommandManager(commandRegistry, commandLoaderRegistry);
  }
  return globalObj[COMMAND_MANAGER_SYMBOL];
}

/**
 * 初始化命令系统
 */
export async function initializeCommands(): Promise<void> {
  const manager = getCommandManager();
  await manager.initialize();
}
