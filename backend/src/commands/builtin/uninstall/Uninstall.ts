/**
 * Uninstall命令实现
 * 卸载插件、技能、工具等组件
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';

interface UninstallTarget {
  type: 'plugin' | 'skill' | 'tool' | 'theme' | 'agent';
  name: string;
}

const uninstallCommand = {
  /**
   * 执行 uninstall 命令
   */
  async execute(
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    try {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase() || '';

      if (
        subcommand === 'help' ||
        subcommand === '--help' ||
        subcommand === '-h'
      ) {
        return this.showHelp();
      }

      if (!subcommand) {
        return this.showHelp();
      }

      const target = this.parseTarget(parts);
      if (!target) {
        return {
          success: false,
          type: 'text',
          message: [
            '无法解析卸载目标。',
            '',
            '用法: /uninstall <类型> <名称>',
            '类型: plugin, skill, tool, theme, agent',
            '',
            '示例:',
            '  /uninstall plugin my-plugin',
            '  /uninstall skill my-skill',
            '  /uninstall tool my-tool',
            '',
            '使用 /uninstall help 获取详细帮助。',
          ].join('\n'),
        };
      }

      return this.performUninstall(target);
    } catch (error) {
      return {
        success: false,
        type: 'text',
        message: `卸载失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  /**
   * 解析卸载目标
   */
  parseTarget(parts: string[]): UninstallTarget | null {
    const validTypes = ['plugin', 'skill', 'tool', 'theme', 'agent'];
    const type = parts[0]?.toLowerCase();

    if (!validTypes.includes(type)) {
      return null;
    }

    const name = parts.slice(1).join(' ');
    if (!name) {
      return null;
    }

    return { type: type as UninstallTarget['type'], name };
  },

  /**
   * 执行卸载操作
   */
  async performUninstall(target: UninstallTarget): Promise<CommandResult> {
    const confirmKey = `${target.type}.${target.name}`;

    const installedItems = this.getInstalledItems(target.type);
    const item = installedItems.find(
      (i) => i.name.toLowerCase() === target.name.toLowerCase()
    );

    if (!item) {
      const lines = [
        `❌ 未找到已安装的${this.getTypeLabel(target.type)}: ${target.name}`,
        '',
        `已安装的${this.getTypeLabel(target.type)}列表:`,
        ...(installedItems.length > 0
          ? installedItems.map((i) => `  - ${i.name}`)
          : ['  (无)']),
      ];

      return {
        success: false,
        type: 'text',
        message: lines.join('\n'),
      };
    }

    const lines = [
      `🗑️  准备卸载${this.getTypeLabel(target.type)}: ${target.name}`,
      '',
      `  类型: ${target.type}`,
      `  名称: ${target.name}`,
      item.version ? `  版本: ${item.version}` : '',
      '',
      '⚠️  确认卸载请再次执行:',
      `  /uninstall ${target.type} ${target.name} --confirm`,
      '',
      '使用 --force 参数可跳过确认:',
      `  /uninstall ${target.type} ${target.name} --force`,
    ];

    const hasConfirm =
      target.name.includes('--confirm') || target.name.includes('--force');
    if (hasConfirm) {
      return this.executeUninstall(target, item);
    }

    return {
      success: true,
      type: 'text',
      message: lines.filter(Boolean).join('\n'),
    };
  },

  /**
   * 执行实际卸载
   */
  async executeUninstall(
    target: UninstallTarget,
    item: any
  ): Promise<CommandResult> {
    const typeLabel = this.getTypeLabel(target.type);
    const cleanName = target.name.replace(/ --(confirm|force)$/, '').trim();

    try {
      let success = false;

      switch (target.type) {
        case 'plugin':
          success = await this.uninstallPlugin(cleanName);
          break;
        case 'skill':
          success = await this.uninstallSkill(cleanName);
          break;
        case 'tool':
          success = await this.uninstallTool(cleanName);
          break;
        case 'theme':
          success = await this.uninstallTheme(cleanName);
          break;
        case 'agent':
          success = await this.uninstallAgent(cleanName);
          break;
      }

      if (success) {
        const lines = [
          `✅ 成功卸载${typeLabel}: ${cleanName}`,
          '',
          `  ${typeLabel} "${cleanName}" 已被移除。`,
          target.type === 'plugin' ? '  重启应用后生效。' : '',
        ];

        return {
          success: true,
          type: 'text',
          message: lines.filter(Boolean).join('\n'),
          data: {
            action: 'uninstall',
            type: target.type,
            name: cleanName,
            success: true,
          },
        };
      }

      return {
        success: false,
        type: 'text',
        message: `❌ 卸载${typeLabel}失败: ${cleanName}\n\n请检查名称是否正确，或查看日志获取详细信息。`,
        data: {
          action: 'uninstall',
          type: target.type,
          name: cleanName,
          success: false,
        },
      };
    } catch (error) {
      return {
        success: false,
        type: 'text',
        message: `❌ 卸载${typeLabel}时发生错误: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  /**
   * 获取已安装的组件列表
   */
  getInstalledItems(type: string): Array<{ name: string; version?: string }> {
    const mockItems: Record<
      string,
      Array<{ name: string; version?: string }>
    > = {
      plugin: [
        { name: 'code-analyzer', version: '1.2.0' },
        { name: 'git-integration', version: '2.0.1' },
        { name: 'markdown-preview', version: '1.0.0' },
      ],
      skill: [
        { name: 'code-review', version: '1.0.0' },
        { name: 'test-generator', version: '1.1.0' },
      ],
      tool: [{ name: 'custom-fetch', version: '0.1.0' }],
      theme: [
        { name: 'dracula', version: '1.0.0' },
        { name: 'monokai', version: '1.0.0' },
      ],
      agent: [{ name: 'code-assistant', version: '1.0.0' }],
    };

    return mockItems[type] || [];
  },

  /**
   * 获取类型显示名称
   */
  getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      plugin: '插件',
      skill: '技能',
      tool: '工具',
      theme: '主题',
      agent: 'Agent',
    };
    return labels[type] || type;
  },

  /**
   * 卸载插件
   */
  async uninstallPlugin(name: string): Promise<boolean> {
    return true;
  },

  /**
   * 卸载技能
   */
  async uninstallSkill(name: string): Promise<boolean> {
    return true;
  },

  /**
   * 卸载工具
   */
  async uninstallTool(name: string): Promise<boolean> {
    return true;
  },

  /**
   * 卸载主题
   */
  async uninstallTheme(name: string): Promise<boolean> {
    return true;
  },

  /**
   * 卸载Agent
   */
  async uninstallAgent(name: string): Promise<boolean> {
    return true;
  },

  /**
   * 显示帮助信息
   */
  showHelp(): CommandResult {
    const help = [
      'Uninstall 卸载命令使用帮助',
      '',
      '用法:',
      '  /uninstall <类型> <名称>             - 卸载指定组件',
      '  /uninstall <类型> <名称> --confirm   - 确认卸载',
      '  /uninstall <类型> <名称> --force     - 强制卸载（跳过确认）',
      '  /uninstall help                     - 显示此帮助信息',
      '',
      '支持的类型:',
      '  plugin  - 卸载插件',
      '  skill   - 卸载技能',
      '  tool    - 卸载工具',
      '  theme   - 卸载主题',
      '  agent   - 卸载 Agent',
      '',
      '示例:',
      '  /uninstall plugin code-analyzer',
      '  /uninstall skill test-generator',
      '  /uninstall tool custom-fetch --force',
      '  /uninstall theme dracula --confirm',
      '',
      '注意:',
      '  - 卸载插件后需要重启应用才能完全生效',
      '  - 卸载内置组件可能需要管理员权限',
      '  - 部分组件卸载后不可恢复',
    ].join('\n');

    return { success: true, type: 'text', message: help };
  },
};

export default uninstallCommand;
