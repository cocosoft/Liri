/**
 * 发布说明命令实现
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';

export default {
  /**
   * 执行发布说明命令
   * @param args 参数
   * @param context 命令上下文
   * @returns 命令结果
   */
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    const parts = args.trim().split(' ');
    const subcommand = parts[0] || 'latest';

    switch (subcommand.toLowerCase()) {
      case 'latest':
        return this.handleLatest(context);
      case 'all':
        return this.handleAll(context);
      case 'version':
        return this.handleVersion(parts[1], context);
      case 'search':
        return this.handleSearch(parts.slice(1), context);
      case 'help':
        return this.handleHelp();
      default:
        return this.handleLatest(context);
    }
  },

  /**
   * 显示最新发布说明
   */
  async handleLatest(context: CommandContext): Promise<CommandResult> {
    const latestRelease = {
      version: '1.2.0',
      date: '2024-01-15',
      title: '性能优化与新功能',
      changes: [
        { type: 'new', text: '新增自定义主题功能' },
        { type: 'improved', text: '优化命令响应速度，提升30%' },
        { type: 'fixed', text: '修复上下文清理问题' },
        { type: 'new', text: '新增沙箱模式' },
      ],
    };

    const changesList = latestRelease.changes
      .map((c) => {
        const icon =
          c.type === 'new' ? '✨' : c.type === 'improved' ? '⚡' : '🐛';
        return `${icon} ${c.text}`;
      })
      .join('\n');

    return {
      success: true,
      type: 'text',
      message:
        `最新发布: v${latestRelease.version} (${latestRelease.date})\n\n` +
        `${latestRelease.title}\n\n` +
        `更新内容:\n${changesList}\n\n` +
        `使用 /release-notes all 查看所有版本`,
      data: latestRelease,
    };
  },

  /**
   * 显示所有发布说明
   */
  async handleAll(context: CommandContext): Promise<CommandResult> {
    const releases = [
      { version: '1.2.0', date: '2024-01-15', title: '性能优化与新功能' },
      { version: '1.1.0', date: '2024-01-01', title: '插件系统上线' },
      { version: '1.0.0', date: '2023-12-01', title: '初始版本发布' },
      { version: '0.9.0', date: '2023-11-15', title: 'Beta测试版本' },
    ];

    const table = releases
      .map((r) => `v${r.version.padEnd(8)} ${r.date}  ${r.title}`)
      .join('\n');

    return {
      success: true,
      type: 'text',
      message:
        `发布历史:\n\n${table}\n\n` +
        `使用 /release-notes version <版本号> 查看详情`,
      data: releases,
    };
  },

  /**
   * 显示指定版本发布说明
   */
  async handleVersion(
    version: string,
    context: CommandContext
  ): Promise<CommandResult> {
    if (!version) {
      return {
        success: false,
        type: 'error',
        error: '请指定版本号',
        message: '用法: /release-notes version <版本号>',
      };
    }

    const releaseNotes: Record<
      string,
      { date: string; changes: { type: string; text: string }[] }
    > = {
      '1.2.0': {
        date: '2024-01-15',
        changes: [
          { type: 'new', text: '新增自定义主题功能' },
          { type: 'improved', text: '优化命令响应速度' },
          { type: 'fixed', text: '修复上下文清理问题' },
        ],
      },
      '1.1.0': {
        date: '2024-01-01',
        changes: [
          { type: 'new', text: '插件系统正式上线' },
          { type: 'new', text: '新增MCP命令支持' },
          { type: 'improved', text: '改进错误处理' },
        ],
      },
      '1.0.0': {
        date: '2023-12-01',
        changes: [
          { type: 'new', text: '初始版本发布' },
          { type: 'new', text: '基础命令系统' },
          { type: 'new', text: '会话管理功能' },
        ],
      },
    };

    const release = releaseNotes[version];

    if (!release) {
      return {
        success: false,
        type: 'error',
        error: `未找到版本 ${version} 的发布说明`,
      };
    }

    const changesList = release.changes
      .map((c) => {
        const icon =
          c.type === 'new' ? '✨' : c.type === 'improved' ? '⚡' : '🐛';
        return `${icon} ${c.text}`;
      })
      .join('\n');

    return {
      success: true,
      type: 'text',
      message: `v${version} (${release.date})\n\n更新内容:\n${changesList}`,
      data: release,
    };
  },

  /**
   * 搜索发布说明
   */
  async handleSearch(
    args: string[],
    context: CommandContext
  ): Promise<CommandResult> {
    const query = args.join(' ').toLowerCase();

    if (!query) {
      return {
        success: false,
        type: 'error',
        error: '请提供搜索关键词',
        message: '用法: /release-notes search <关键词>',
      };
    }

    const allReleases = [
      {
        version: '1.2.0',
        date: '2024-01-15',
        title: '性能优化与新功能',
        matches: ['主题', '沙箱'],
      },
      {
        version: '1.1.0',
        date: '2024-01-01',
        title: '插件系统上线',
        matches: ['插件', 'MCP'],
      },
      {
        version: '1.0.0',
        date: '2023-12-01',
        title: '初始版本发布',
        matches: ['基础', '会话'],
      },
    ];

    const results = allReleases.filter(
      (r) =>
        r.title.toLowerCase().includes(query) ||
        r.matches.some((m) => m.toLowerCase().includes(query))
    );

    if (results.length === 0) {
      return {
        success: false,
        type: 'text',
        message: `未找到包含 "${query}" 的发布说明`,
      };
    }

    const table = results
      .map((r) => `v${r.version.padEnd(8)} ${r.date}  ${r.title}`)
      .join('\n');

    return {
      success: true,
      type: 'text',
      message: `搜索结果:\n\n${table}`,
      data: results,
    };
  },

  /**
   * 显示帮助信息
   */
  async handleHelp(): Promise<CommandResult> {
    const help = `发布说明命令用法:

/release-notes latest        - 显示最新发布说明
/release-notes all          - 显示所有发布版本
/release-notes version <版本> - 显示指定版本说明
/release-notes search <关键词> - 搜索发布说明
/release-notes help         - 显示此帮助信息

示例:
  /release-notes latest
  /release-notes version 1.1.0`;

    return {
      success: true,
      type: 'text',
      message: help,
    };
  },
};
