/**
 * 命令注册表
 * 管理已注册的命令
 */
import type { Command } from '@modules/commands/types';

/**
 * 命令注册表类
 */
export class CommandRegistry {
  /**
   * 命令映射
   */
  private commands: Map<string, Command> = new Map();

  /**
   * 别名映射
   */
  private aliases: Map<string, string> = new Map();

  /**
   * 注册命令
   * @param command 命令对象
   */
  register(command: Command): void {
    if (!command || !command.name) {
      console.error('Invalid command: missing name');
      return;
    }

    this.commands.set(command.name, command);

    // 注册别名
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliases.set(alias, command.name);
      }
    }
  }

  /**
   * 获取命令
   * @param name 命令名或别名
   * @returns 命令对象或undefined
   */
  getCommand(name: string): Command | undefined {
    // 先查找命令名
    let command = this.commands.get(name);
    if (command) {
      return command;
    }

    // 再查找别名
    const commandName = this.aliases.get(name);
    if (commandName) {
      return this.commands.get(commandName);
    }

    return undefined;
  }

  /**
   * 获取所有命令
   * @returns 命令列表
   */
  getAllCommands(): Command[] {
    return Array.from(this.commands.values());
  }

  /**
   * 根据类型获取命令
   * @param type 命令类型
   * @returns 命令列表
   */
  getCommandsByType(type: Command['type']): Command[] {
    return Array.from(this.commands.values()).filter(
      (command) => command.type === type
    );
  }

  /**
   * 根据来源获取命令
   * @param source 命令来源
   * @returns 命令列表
   */
  getCommandsBySource(source: string): Command[] {
    return Array.from(this.commands.values()).filter(
      (command) => command.loadedFrom === source
    );
  }

  /**
   * 移除命令
   * @param name 命令名
   */
  removeCommand(name: string): void {
    const command = this.commands.get(name);
    if (command) {
      // 移除别名
      if (command.aliases) {
        for (const alias of command.aliases) {
          this.aliases.delete(alias);
        }
      }
      // 移除命令
      this.commands.delete(name);
    }
  }

  /**
   * 清空注册表
   */
  clear(): void {
    this.commands.clear();
    this.aliases.clear();
  }

  /**
   * 获取命令数量
   * @returns 命令数量
   */
  getCommandCount(): number {
    return this.commands.size;
  }

  /**
   * 检查命令是否存在
   * @param name 命令名或别名
   * @returns 是否存在
   */
  hasCommand(name: string): boolean {
    return this.commands.has(name) || this.aliases.has(name);
  }

  /**
   * 获取可见的命令
   * @returns 可见的命令列表
   */
  getVisible(): Command[] {
    return Array.from(this.commands.values()).filter(
      (command) => !command.isHidden
    );
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
    const {
      limit,
      searchFields = ['name', 'description', 'aliases', 'whenToUse', 'argumentHint'],
      includeHidden = false,
    } = options;

    const queryLower = query.toLowerCase().trim();
    const results: { command: Command; relevance: number }[] = [];

    for (const command of this.commands.values()) {
      // 跳过隐藏命令（除非明确包含）
      if (command.isHidden && !includeHidden) {
        continue;
      }

      let relevance = 0;

      // 名称匹配（最高权重）
      if (searchFields.includes('name')) {
        if (command.name.toLowerCase() === queryLower) {
          relevance += 20; // 精确匹配
        } else if (command.name.toLowerCase().includes(queryLower)) {
          relevance += 10; // 部分匹配
        }
      }

      // 描述匹配
      if (searchFields.includes('description') && command.description) {
        if (command.description.toLowerCase().includes(queryLower)) {
          relevance += 5;
        }
      }

      // 别名匹配
      if (searchFields.includes('aliases') && command.aliases) {
        for (const alias of command.aliases) {
          if (alias.toLowerCase() === queryLower) {
            relevance += 15; // 别名精确匹配
            break;
          } else if (alias.toLowerCase().includes(queryLower)) {
            relevance += 8; // 别名部分匹配
            break;
          }
        }
      }

      // 使用场景匹配
      if (searchFields.includes('whenToUse') && command.whenToUse) {
        if (command.whenToUse.toLowerCase().includes(queryLower)) {
          relevance += 3;
        }
      }

      // 参数提示匹配
      if (searchFields.includes('argumentHint') && command.argumentHint) {
        if (command.argumentHint.toLowerCase().includes(queryLower)) {
          relevance += 2;
        }
      }

      if (relevance > 0) {
        results.push({ command, relevance });
      }
    }

    // 按相关性排序
    results.sort((a, b) => b.relevance - a.relevance);

    // 限制结果数量
    if (limit && limit > 0) {
      return results.slice(0, limit);
    }

    return results;
  }

  /**
   * 获取命令统计信息
   * @returns 命令统计信息
   */
  getCommandStats(): {
    total: number;
    visible: number;
    hidden: number;
    aliases: number;
    byType: Record<string, number>;
  } {
    const commands = Array.from(this.commands.values());
    const byType: Record<string, number> = {};

    for (const command of commands) {
      const type = command.type || 'unknown';
      byType[type] = (byType[type] || 0) + 1;
    }

    return {
      total: commands.length,
      visible: commands.filter((c) => !c.isHidden).length,
      hidden: commands.filter((c) => c.isHidden).length,
      aliases: this.aliases.size,
      byType,
    };
  }
}

/**
 * 命令注册表实例
 */
export const commandRegistry = new CommandRegistry();
