/**
 * CommandRegistration 插件命令注册系统
 * 对标 OpenClaw 的命令注册体系，允许插件的命令注册到全局命令系统
 */

import type { PluginMetadata } from '../types/PluginTypes.js';

/**
 * 插件命令定义
 */
export interface PluginCommand {
  name: string;
  description: string;
  pluginName: string;
  aliases?: string[];
  argumentHint?: string;
  category?: string;
  execute(
    args: string[],
    context: Record<string, unknown>
  ): Promise<CommandResult>;
}

/**
 * 命令执行结果
 */
export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

/**
 * 命令注册信息
 */
export interface CommandRegistrationEntry {
  command: PluginCommand;
  registeredAt: number;
  enabled: boolean;
}

/**
 * 插件命令注册表
 * 管理所有插件注册的命令，支持注册/注销/查找/执行
 */
export class CommandRegistration {
  private commands: Map<string, CommandRegistrationEntry> = new Map();
  private aliasMap: Map<string, string> = new Map();

  /**
   * 注册插件命令
   */
  register(command: PluginCommand): boolean {
    if (this.commands.has(command.name)) {
      return false;
    }

    const entry: CommandRegistrationEntry = {
      command,
      registeredAt: Date.now(),
      enabled: true,
    };

    this.commands.set(command.name, entry);

    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliasMap.set(alias, command.name);
      }
    }

    return true;
  }

  /**
   * 注销插件命令
   */
  unregister(commandName: string): boolean {
    const entry = this.commands.get(commandName);
    if (!entry) {
      return false;
    }

    if (entry.command.aliases) {
      for (const alias of entry.command.aliases) {
        this.aliasMap.delete(alias);
      }
    }

    return this.commands.delete(commandName);
  }

  /**
   * 按插件名注销所有命令
   */
  unregisterByPlugin(pluginName: string): number {
    let count = 0;
    const toDelete: string[] = [];

    for (const [name, entry] of this.commands.entries()) {
      if (entry.command.pluginName === pluginName) {
        toDelete.push(name);
        count++;
      }
    }

    for (const name of toDelete) {
      this.unregister(name);
    }

    return count;
  }

  /**
   * 查找命令
   */
  find(nameOrAlias: string): PluginCommand | undefined {
    const entry = this.commands.get(nameOrAlias);
    if (entry && entry.enabled) {
      return entry.command;
    }

    const resolved = this.aliasMap.get(nameOrAlias);
    if (resolved) {
      const resolvedEntry = this.commands.get(resolved);
      if (resolvedEntry && resolvedEntry.enabled) {
        return resolvedEntry.command;
      }
    }

    return undefined;
  }

  /**
   * 执行命令
   */
  async execute(
    nameOrAlias: string,
    args: string[],
    context: Record<string, unknown> = {}
  ): Promise<CommandResult> {
    const command = this.find(nameOrAlias);
    if (!command) {
      return {
        success: false,
        message: `命令 "${nameOrAlias}" 未找到或已禁用`,
      };
    }

    try {
      return await command.execute(args, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, message: `命令执行失败: ${message}` };
    }
  }

  /**
   * 获取所有已注册命令
   */
  getAll(): PluginCommand[] {
    const result: PluginCommand[] = [];

    for (const entry of this.commands.values()) {
      if (entry.enabled) {
        result.push(entry.command);
      }
    }

    return result;
  }

  /**
   * 按插件名获取命令
   */
  getByPlugin(pluginName: string): PluginCommand[] {
    const result: PluginCommand[] = [];

    for (const entry of this.commands.values()) {
      if (entry.command.pluginName === pluginName && entry.enabled) {
        result.push(entry.command);
      }
    }

    return result;
  }

  /**
   * 启用/禁用命令
   */
  setEnabled(commandName: string, enabled: boolean): boolean {
    const entry = this.commands.get(commandName);
    if (!entry) {
      return false;
    }

    entry.enabled = enabled;
    return true;
  }

  /**
   * 获取注册统计
   */
  getStats(): {
    total: number;
    enabled: number;
    byPlugin: Record<string, number>;
  } {
    let enabled = 0;
    const byPlugin: Record<string, number> = {};

    for (const entry of this.commands.values()) {
      if (entry.enabled) {
        enabled++;
      }
      byPlugin[entry.command.pluginName] =
        (byPlugin[entry.command.pluginName] || 0) + 1;
    }

    return {
      total: this.commands.size,
      enabled,
      byPlugin,
    };
  }
}

export const commandRegistration = new CommandRegistration();
