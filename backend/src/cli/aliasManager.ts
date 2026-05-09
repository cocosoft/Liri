/**
 * 命令别名管理模块
 * 支持命令别名的定义、解析和执行
 */

import { configManager } from './config';

export class AliasManager {
  private aliases: Record<string, string> = {};

  constructor() {
    this.loadAliases();
  }

  /**
   * 从配置加载别名
   */
  private loadAliases(): void {
    this.aliases = { ...configManager.getAliases() };
  }

  /**
   * 添加别名
   */
  addAlias(name: string, command: string): void {
    this.aliases[name] = command;
    configManager.addAlias(name, command);
  }

  /**
   * 删除别名
   */
  removeAlias(name: string): boolean {
    if (this.aliases[name]) {
      delete this.aliases[name];
      return configManager.removeAlias(name);
    }
    return false;
  }

  /**
   * 获取别名对应的命令
   */
  getAlias(name: string): string | undefined {
    return this.aliases[name];
  }

  /**
   * 检查别名是否存在
   */
  hasAlias(name: string): boolean {
    return !!this.aliases[name];
  }

  /**
   * 获取所有别名
   */
  getAllAliases(): Record<string, string> {
    return { ...this.aliases };
  }

  /**
   * 解析命令行（替换别名）
   */
  parseCommand(input: string): string {
    const parts = input.trim().split(' ');
    if (parts.length === 0) return input;

    const command = parts[0];
    if (this.hasAlias(command)) {
      const aliasCommand = this.aliases[command];
      const args = parts.slice(1).join(' ');
      return args ? `${aliasCommand} ${args}` : aliasCommand;
    }

    return input;
  }

  /**
   * 展开别名（递归展开）
   */
  expandAlias(input: string): string {
    let result = input;
    let changed = true;
    let iterations = 0;

    while (changed && iterations < 10) {
      changed = false;
      const parts = result.trim().split(' ');
      if (parts.length > 0 && this.hasAlias(parts[0])) {
        const aliasCommand = this.aliases[parts[0]];
        const args = parts.slice(1).join(' ');
        result = args ? `${aliasCommand} ${args}` : aliasCommand;
        changed = true;
      }
      iterations++;
    }

    return result;
  }

  /**
   * 执行别名命令
   */
  executeAlias(name: string, args?: string[]): string | null {
    const command = this.getAlias(name);
    if (!command) return null;

    if (args && args.length > 0) {
      return `${command} ${args.join(' ')}`;
    }

    return command;
  }

  /**
   * 列出所有别名
   */
  list(): Array<{ name: string; command: string }> {
    return Object.entries(this.aliases).map(([name, command]) => ({
      name,
      command,
    }));
  }

  /**
   * 搜索别名
   */
  search(pattern: string): Array<{ name: string; command: string }> {
    const regex = new RegExp(pattern, 'i');
    return Object.entries(this.aliases)
      .filter(([name]) => regex.test(name))
      .map(([name, command]) => ({ name, command }));
  }

  /**
   * 导出别名配置
   */
  exportConfig(): string {
    return JSON.stringify(this.aliases, null, 2);
  }

  /**
   * 导入别名配置
   */
  importConfig(config: string): boolean {
    try {
      const parsed = JSON.parse(config);
      if (typeof parsed === 'object' && parsed !== null) {
        this.aliases = { ...parsed };
        // 保存到配置
        Object.entries(this.aliases).forEach(([name, command]) => {
          configManager.addAlias(name, command);
        });
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  /**
   * 重置别名到默认值
   */
  reset(): void {
    this.aliases = {};
    // 清除配置中的别名
    Object.keys(configManager.getAliases()).forEach((name) => {
      configManager.removeAlias(name);
    });
  }
}

/**
 * 创建别名管理器实例
 */
export function createAliasManager(): AliasManager {
  return new AliasManager();
}

/**
 * 全局别名管理器实例
 */
export const aliasManager = createAliasManager();
