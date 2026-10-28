/**
 * 命令注册表
 * 管理已注册的命令
 */
import type { Command, CommandSource } from '@modules/commands';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('CommandRegistry');

/**
 * 命令注册表类
 *
 * 权限元数据（方案 §8.4「顺序红线」）：命令此前**一个权限元数据都没有**，且同名注册是
 * `Map.set` **静默覆盖**。在开放"外部注册"之前必须先补三件事：
 *   ① 冲突 = `error`（拒绝覆盖，不再静默换实现）；
 *   ② `source: 'builtin' | 'plugin'`（信任等级，缺省 `builtin`）；
 *   ③ `plugin` **默认需要审批**（`requiresApproval` 缺省按 `source` 派生，fail-closed）。
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
   *
   * 冲突策略 = **error**（方案 §8.4）：命令名 / 别名被**另一个所有者**占用时拒绝登记并记 error，
   * 不再像旧实现那样 `Map.set` 静默覆盖（那会让"谁的实现生效"取决于加载顺序，且无任何观测）。
   * 同一加载器（`loadedFrom` 相同）重复注册视为**幂等重载** ⇒ 覆盖并告警（保留热重载语义）。
   *
   * @param command 命令对象
   * @returns 是否登记成功（命令名冲突被拒 ⇒ `false`）
   */
  register(command: Command): boolean {
    if (!command || !command.name) {
      logger.error('Invalid command: missing name');
      return false;
    }

    const existing = this.commands.get(command.name);
    if (existing && existing !== command) {
      const sameOwner =
        existing.loadedFrom !== undefined &&
        existing.loadedFrom === command.loadedFrom;
      if (!sameOwner) {
        logger.error(
          '命令名冲突 ⇒ 拒绝登记（onConflict=error，不覆盖已注册实现）',
          {
            command: command.name,
            existingFrom: existing.loadedFrom ?? '(unknown)',
            incomingFrom: command.loadedFrom ?? '(unknown)',
            incomingSource: command.source ?? 'builtin',
          }
        );
        return false;
      }
      logger.warn('命令重复注册（同一加载器）⇒ 覆盖旧实例', {
        command: command.name,
        loadedFrom: command.loadedFrom,
      });
    }

    this.commands.set(command.name, command);

    // 注册别名（冲突 ⇒ 拒绝该别名，不覆盖他人）
    for (const alias of command.aliases ?? []) {
      const owner = this.aliases.get(alias);
      if (owner !== undefined && owner !== command.name) {
        logger.error('命令别名冲突 ⇒ 拒绝登记该别名（onConflict=error）', {
          command: command.name,
          alias,
          occupiedBy: owner,
        });
        continue;
      }
      const realNameOwner = this.commands.get(alias);
      if (realNameOwner && realNameOwner !== command) {
        logger.error('命令别名与已注册命令同名 ⇒ 拒绝登记该别名', {
          command: command.name,
          alias,
        });
        continue;
      }
      this.aliases.set(alias, command.name);
    }

    return true;
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
   * 命令的**信任等级**（`source` 未声明 ⇒ `builtin`）。
   *
   * ⚠️ 与 `getCommandsBySource(loadedFrom)` 不同：后者是加载器观测口径，本方法是授权口径。
   */
  getCommandSource(name: string): CommandSource {
    return this.getCommand(name)?.source ?? 'builtin';
  }

  /**
   * 该命令是否需要用户审批（**fail-closed**）。
   *
   * 判定：显式 `requiresApproval` 优先；否则 `source === 'plugin'` ⇒ `true`。
   * 未注册的命令 ⇒ `false`（调用方在 `getCommand()` 为 `undefined` 时本就不会执行）。
   */
  requiresApproval(name: string): boolean {
    const command = this.getCommand(name);
    if (!command) return false;
    return command.requiresApproval ?? command.source === 'plugin';
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
      searchFields?: (
        | 'name'
        | 'description'
        | 'aliases'
        | 'whenToUse'
        | 'argumentHint'
      )[];
      includeHidden?: boolean;
    } = {}
  ): { command: Command; relevance: number }[] {
    const {
      limit,
      searchFields = [
        'name',
        'description',
        'aliases',
        'whenToUse',
        'argumentHint',
      ],
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
