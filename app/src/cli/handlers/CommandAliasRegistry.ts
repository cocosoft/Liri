/**
 * CommandAliasRegistry — 命令别名注册表
 *
 * 对标 OpenClaw manifest-command-aliases.ts 的别名机制：
 * PluginManifestCommandAliasRegistry 将别名解析到插件命令。
 *
 * Liri 的实现将别名注册到 CLIHandler 的命令系统，
 * 支持内置别名和动态注册。
 *
 * 内置别名（默认注册）：
 *   cfg  → config
 *   sess → sessions
 *   diag → diagnose
 *   sess list → sessions list
 *   diag health → diagnose health
 */

import { getLogger } from '@modules/monitoring';

const logger = getLogger('CommandAliasRegistry');

/**
 * 命令别名条目
 */
export interface CommandAliasEntry {
  /** 别名 */
  alias: string;

  /** 目标命令 */
  target: string;

  /** 可选描述 */
  description?: string;

  /** 来源插件（可选） */
  pluginId?: string;
}

/**
 * CommandAliasRegistry — 命令别名注册表
 */
export class CommandAliasRegistry {
  private aliases: Map<string, CommandAliasEntry> = new Map();

  /**
   * 注册内置别名
   */
  constructor() {
    this.registerBuiltins();
  }

  private registerBuiltins(): void {
    const builtins: CommandAliasEntry[] = [
      { alias: 'cfg', target: 'config', description: '配置管理' },
      { alias: 'sess', target: 'sessions', description: '会话管理' },
      { alias: 'diag', target: 'diagnose', description: '系统诊断' },
      { alias: 'doc', target: 'docs', description: '文档查询' },
      { alias: 'sk', target: 'skills', description: '技能管理' },
      { alias: 'tl', target: 'tools', description: '工具管理' },
      { alias: 'plug', target: 'plugins', description: '插件管理' },
      { alias: 'agt', target: 'agents', description: '代理管理' },
      { alias: 'svr', target: 'mcp', description: 'MCP 服务器管理' },
      { alias: 'env', target: 'env', description: '环境变量' },
    ];
    for (const entry of builtins) {
      this.aliases.set(entry.alias, entry);
    }
  }

  /**
   * 注册别名
   */
  registerAlias(
    alias: string,
    target: string,
    description?: string,
    pluginId?: string
  ): void {
    const key = alias.toLowerCase().trim();
    if (!key) {
      logger.warn('别名注册失败：别名为空');
      return;
    }
    if (!target.trim()) {
      logger.warn('别名注册失败：目标命令为空', { alias });
      return;
    }

    const existing = this.aliases.get(key);
    if (existing) {
      logger.warn('别名已被覆盖', {
        alias,
        oldTarget: existing.target,
        newTarget: target,
      });
    }

    this.aliases.set(key, {
      alias: key,
      target: target.trim(),
      description: description?.trim(),
      pluginId,
    });

    logger.debug('别名已注册', { alias, target, pluginId });
  }

  /**
   * 批量注册别名
   */
  registerAliases(entries: CommandAliasEntry[]): void {
    for (const entry of entries) {
      this.registerAlias(
        entry.alias,
        entry.target,
        entry.description,
        entry.pluginId
      );
    }
  }

  /**
   * 解析别名
   *
   * @param input 用户输入的命令（可能带参数）
   * @returns 解析结果，包含目标命令和剩余参数
   *
   * @example
   * resolveAlias('cfg set log.level debug')
   * // → { resolved: 'config set log.level debug', alias: 'cfg', target: 'config', args: 'set log.level debug' }
   */
  resolveAlias(input: string): {
    resolved: string;
    alias: string;
    target: string;
    args: string;
  } | null {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const parts = trimmed.split(/\s+/);
    const firstWord = parts[0].toLowerCase();
    const entry = this.aliases.get(firstWord);

    if (!entry) return null;

    const args = parts.slice(1).join(' ');
    const resolved = args ? `${entry.target} ${args}` : entry.target;

    return {
      resolved,
      alias: entry.alias,
      target: entry.target,
      args,
    };
  }

  /**
   * 移除别名
   */
  unregisterAlias(alias: string): boolean {
    const key = alias.toLowerCase().trim();
    const existed = this.aliases.has(key);
    this.aliases.delete(key);
    return existed;
  }

  /**
   * 获取所有已注册别名
   */
  listAliases(): CommandAliasEntry[] {
    return Array.from(this.aliases.values());
  }

  /**
   * 检查输入是否为别名
   */
  isAlias(input: string): boolean {
    const firstWord = input.trim().split(/\s+/)[0]?.toLowerCase();
    return firstWord ? this.aliases.has(firstWord) : false;
  }
}
