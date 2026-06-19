/**
 * CommandCatalog 命令目录
 * 增强的命令发现与分类系统，提供命令的层次化组织和多维索引
 */
import type { Command, CommandType } from '@modules/commands';

/**
 * 命令分类
 */
export interface CommandCategory {
  name: string;
  description: string;
  icon: string;
  commands: string[];
  subcategories?: CommandCategory[];
}

/**
 * 命令标签
 */
export interface CommandTag {
  name: string;
  description: string;
}

/**
 * 命令使用统计
 */
export interface CommandUsageStats {
  name: string;
  invokeCount: number;
  lastUsed: number;
  avgDuration: number;
  favorite: boolean;
}

/**
 * 命令搜索选项
 */
export interface CommandSearchOptions {
  query?: string;
  category?: string;
  type?: CommandType;
  tags?: string[];
  exact?: boolean;
}

/**
 * 命令目录管理器
 * 提供命令的聚合、分类、搜索与统计功能
 */
export class CommandCatalog {
  private categories: Map<string, CommandCategory> = new Map();
  private tags: Map<string, CommandTag> = new Map();
  private usageStats: Map<string, CommandUsageStats> = new Map();
  private commandIndex: Map<string, Command> = new Map();
  private relatedCommands: Map<string, string[]> = new Map();

  /**
   * 注册默认分类体系
   */
  constructor() {
    this.registerDefaultCategories();
    this.registerDefaultTags();
  }

  /**
   * 注册默认分类
   */
  private registerDefaultCategories(): void {
    const defaultCategories: CommandCategory[] = [
      {
        name: '基础操作',
        description: '应用基础操作命令',
        icon: '⚙️',
        commands: [
          'help',
          'config',
          'status',
          'version',
          'clear',
          'exit',
          'restart',
        ],
        subcategories: [
          {
            name: '配置管理',
            description: '应用配置相关',
            icon: '🔧',
            commands: ['config', 'theme', 'env', 'privacy-settings'],
          },
          {
            name: '系统信息',
            description: '系统状态与信息',
            icon: 'ℹ️',
            commands: ['status', 'version', 'health', 'doctor'],
          },
        ],
      },
      {
        name: '文件操作',
        description: '文件与目录操作命令',
        icon: '📁',
        commands: [
          'read',
          'write',
          'edit',
          'search',
          'list',
          'add-dir',
          'copy',
          'rename',
          'delete',
          'files',
        ],
      },
      {
        name: '代码开发',
        description: '代码开发相关命令',
        icon: '💻',
        commands: [
          'git',
          'commit',
          'diff',
          'branch',
          'review',
          'debug',
          'test',
          'build',
          'deploy',
        ],
      },
      {
        name: 'AI 与对话',
        description: 'AI 对话与智能辅助命令',
        icon: '🤖',
        commands: [
          'chat',
          'ask',
          'explain',
          'refactor',
          'optimize',
          'complete',
          'effort',
        ],
      },
      {
        name: '技能与插件',
        description: '技能与插件管理命令',
        icon: '🧩',
        commands: [
          'skill',
          'plugins',
          'install',
          'uninstall',
          'upgrade',
          'update',
          'reload-plugins',
        ],
      },
      {
        name: '会话管理',
        description: '会话与上下文管理命令',
        icon: '💬',
        commands: [
          'session',
          'history',
          'context',
          'resume',
          'compact',
          'rewind',
        ],
      },
      {
        name: '通道管理',
        description: '消息通道与通信管理',
        icon: '📡',
        commands: ['channel', 'gateway', 'bridge'],
      },
      {
        name: 'Agent 管理',
        description: 'Agent 实例与协作管理',
        icon: '🧠',
        commands: ['agent', 'subagent', 'parallel'],
      },
      {
        name: '安全与权限',
        description: '安全设置与权限管理',
        icon: '🔒',
        commands: [
          'security',
          'permissions',
          'sandbox-toggle',
          'security-review',
        ],
      },
      {
        name: '监控与分析',
        description: '系统监控与数据分析',
        icon: '📊',
        commands: [
          'performance',
          'usage',
          'cost',
          'tokens',
          'activity',
          'insights',
          'memory',
          'heapdump',
        ],
      },
      {
        name: '文档与学习',
        description: '文档查看与学习资源',
        icon: '📖',
        commands: [
          'docs',
          'help',
          'onboard',
          'tutorial',
          'release-notes',
          'keybindings',
          'tips',
        ],
      },
      {
        name: '任务与项目',
        description: '任务管理与项目协作',
        icon: '✅',
        commands: [
          'tasks',
          'plan',
          'checkpoint',
          'export',
          'share',
          'feedback',
        ],
      },
    ];

    for (const cat of defaultCategories) {
      this.categories.set(cat.name, cat);
    }
  }

  /**
   * 注册默认标签
   */
  private registerDefaultTags(): void {
    const defaultTags: CommandTag[] = [
      { name: 'core', description: '核心功能命令' },
      { name: 'file', description: '文件操作' },
      { name: 'git', description: 'Git 集成' },
      { name: 'ai', description: 'AI 驱动' },
      { name: 'plugin', description: '插件管理' },
      { name: 'skill', description: '技能管理' },
      { name: 'security', description: '安全相关' },
      { name: 'config', description: '配置管理' },
      { name: 'monitor', description: '监控与诊断' },
      { name: 'network', description: '网络相关' },
      { name: 'agent', description: 'Agent 管理' },
      { name: 'channel', description: '通道管理' },
      { name: 'session', description: '会话管理' },
      { name: 'task', description: '任务管理' },
      { name: 'dev', description: '开发工具' },
      { name: 'dangerous', description: '危险操作（需谨慎）' },
    ];

    for (const tag of defaultTags) {
      this.tags.set(tag.name, tag);
    }
  }

  /**
   * 同步命令到目录索引
   */
  syncCommands(commands: Command[]): void {
    this.commandIndex.clear();

    for (const cmd of commands) {
      this.commandIndex.set(cmd.name, cmd);
      if (cmd.aliases) {
        for (const alias of cmd.aliases) {
          this.commandIndex.set(alias, cmd);
        }
      }
    }
  }

  /**
   * 获取所有分类
   */
  getCategories(): CommandCategory[] {
    return Array.from(this.categories.values());
  }

  /**
   * 获取指定分类
   */
  getCategory(name: string): CommandCategory | undefined {
    return this.categories.get(name);
  }

  /**
   * 注册相关命令（关联推荐）
   */
  registerRelated(source: string, related: string[]): void {
    this.relatedCommands.set(source, related);
  }

  /**
   * 获取相关命令推荐
   */
  getRelated(name: string): string[] {
    return this.relatedCommands.get(name) || [];
  }

  /**
   * 搜索命令
   */
  searchCommands(options: CommandSearchOptions): Command[] {
    const results: Command[] = [];
    const query = options.query?.toLowerCase() || '';

    for (const cmd of this.commandIndex.values()) {
      let matched = true;

      if (options.type && cmd.type !== options.type) {
        matched = false;
      }

      if (query) {
        if (options.exact) {
          matched = cmd.name === query || (cmd.aliases || []).includes(query);
        } else {
          const nameMatch = cmd.name.toLowerCase().includes(query);
          const descMatch = cmd.description.toLowerCase().includes(query);
          const aliasMatch = (cmd.aliases || []).some((a: string) =>
            a.toLowerCase().includes(query)
          );
          matched = nameMatch || descMatch || aliasMatch;
        }
      }

      if (matched && !results.some((r) => r.name === cmd.name)) {
        results.push(cmd);
      }
    }

    return results;
  }

  /**
   * 按分类获取命令
   */
  getCommandsByCategory(categoryName: string): Command[] {
    const cat = this.categories.get(categoryName);
    if (!cat) return [];

    const allNames = new Set<string>();
    const collectNames = (c: CommandCategory): void => {
      for (const n of c.commands) allNames.add(n);
      for (const sub of c.subcategories || []) collectNames(sub);
    };
    collectNames(cat);

    return Array.from(allNames)
      .map((n) => this.commandIndex.get(n))
      .filter((c): c is Command => !!c);
  }

  /**
   * 获取命令统计
   */
  getUsageStats(): CommandUsageStats[] {
    return Array.from(this.usageStats.values()).sort(
      (a, b) => b.invokeCount - a.invokeCount
    );
  }

  /**
   * 记录命令调用
   */
  recordInvocation(name: string, duration: number): void {
    const existing = this.usageStats.get(name);
    if (existing) {
      existing.invokeCount++;
      existing.lastUsed = Date.now();
      existing.avgDuration =
        (existing.avgDuration * (existing.invokeCount - 1) + duration) /
        existing.invokeCount;
    } else {
      this.usageStats.set(name, {
        name,
        invokeCount: 1,
        lastUsed: Date.now(),
        avgDuration: duration,
        favorite: false,
      });
    }
  }

  /**
   * 获取最常用命令
   */
  getMostUsedCommands(limit: number = 10): CommandUsageStats[] {
    return this.getUsageStats().slice(0, limit);
  }

  /**
   * 获取最近使用命令
   */
  getRecentCommands(limit: number = 10): CommandUsageStats[] {
    return this.getUsageStats()
      .sort((a, b) => b.lastUsed - a.lastUsed)
      .slice(0, limit);
  }

  /**
   * 标记收藏命令
   */
  toggleFavorite(name: string): boolean {
    const stats = this.usageStats.get(name);
    if (stats) {
      stats.favorite = !stats.favorite;
      return stats.favorite;
    }
    this.usageStats.set(name, {
      name,
      invokeCount: 0,
      lastUsed: Date.now(),
      avgDuration: 0,
      favorite: true,
    });
    return true;
  }

  /**
   * 获取收藏命令
   */
  getFavorites(): CommandUsageStats[] {
    return Array.from(this.usageStats.values()).filter((s) => s.favorite);
  }

  /**
   * 获取命令总数
   */
  getCommandCount(): number {
    return this.commandIndex.size;
  }

  /**
   * 获取分类总数
   */
  getCategoryCount(): number {
    return this.categories.size;
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.usageStats.clear();
  }
}

export const commandCatalog = new CommandCatalog();
