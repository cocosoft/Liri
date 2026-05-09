/**
 * Plugins命令实现
 * 插件管理和状态查看
 */
import type { CommandContext, CommandResult } from '@modules/commands/types';

interface PluginInfo {
  name: string;
  version: string;
  state: string;
  path: string;
  dependencies: string[];
  error?: string;
}

interface PluginsData {
  plugins: PluginInfo[];
  total: number;
  enabledCount: number;
  disabledCount: number;
  errorCount: number;
}

const pluginsCommand = {
  /**
   * 执行 plugins 命令
   */
  async execute(
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    try {
      const cleanArgs = args.trim().toLowerCase();
      const useJson = cleanArgs.includes('--json');

      if (
        cleanArgs === 'help' ||
        cleanArgs === '--help' ||
        cleanArgs === '-h'
      ) {
        return this.showHelp();
      }

      if (
        cleanArgs === 'status' ||
        cleanArgs === '--status' ||
        cleanArgs === '-s'
      ) {
        return await this.showStatus(useJson);
      }

      if (cleanArgs === '--list' || cleanArgs === '-l') {
        return await this.listPlugins(useJson);
      }

      if (cleanArgs === '--test' || cleanArgs === '-t') {
        return await this.testPlugins(useJson);
      }

      if (cleanArgs === '--json') {
        return await this.listPlugins(true);
      }

      if (cleanArgs === '') {
        return await this.listPlugins(false);
      }

      return {
        success: false,
        message: `未知参数: ${args}\n使用 /plugins help 查看帮助`,
      };
    } catch (error) {
      return {
        success: false,
        message: `操作失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },

  /**
   * 显示帮助信息
   */
  showHelp(): CommandResult {
    const help = `Plugins 命令使用帮助

用法:
  /plugins                    - 列出所有插件
  /plugins --list (-l)        - 列出所有插件
  /plugins --status (-s)      - 显示插件状态报告
  /plugins --test (-t)        - 测试插件连接
  /plugins status             - 显示插件系统状态
  /plugins --json             - 以 JSON 格式输出
  /plugins help               - 显示此帮助

子命令说明:
  --list (-l)   列出所有已注册的插件及其基本信息
  --status (-s) 显示插件系统的状态概览和统计信息
  --test (-t)   测试所有插件的连接和状态检查
  status        显示插件系统总体状态（加载、启用、禁用等统计）
  --json        以 JSON 格式输出结果（可与其他子命令组合）

状态说明:
  ACTIVATED     - 已激活（正常工作）
  LOADED        - 已加载（等待激活）
  DEACTIVATED   - 已停用
  FAILED        - 加载失败
  UNLOADED      - 未加载

别名: /plugin, /extensions

  `;

    return { success: true, message: help };
  },

  /**
   * 显示插件系统状态
   */
  async showStatus(useJson: boolean): Promise<CommandResult> {
    const data = await this.collectPluginsData();

    try {
      const { logEvent } = await import('@modules/services/analytics/index.js');
      logEvent('tengu_plugins_status', {
        total: data.total,
        enabled: data.enabledCount,
        failed: data.errorCount,
      });
    } catch {
      // analytics 非关键
    }

    const { total, enabledCount, disabledCount, errorCount } = data;

    if (useJson) {
      return {
        success: true,
        message: JSON.stringify(
          {
            totalPlugins: total,
            enabled: enabledCount,
            disabled: disabledCount,
            failed: errorCount,
            plugins: data.plugins.map((p) => ({
              name: p.name,
              version: p.version,
              state: p.state,
              path: p.path,
              dependencies: p.dependencies,
            })),
          },
          null,
          2
        ),
      };
    }

    const status = [
      '插件系统状态',
      '',
      `  总插件数: ${total}`,
      `  已激活:   ${enabledCount}`,
      `  已停用:   ${disabledCount}`,
      `  异常:     ${errorCount}`,
      '',
      '插件列表:',
      ...data.plugins.map(
        (p) =>
          `    ${this.getStateIcon(p.state)} ${p.name} v${p.version} - ${this.getStateText(p.state)}`
      ),
    ];

    return { success: true, message: status.join('\n') };
  },

  /**
   * 列出所有插件
   */
  async listPlugins(useJson: boolean): Promise<CommandResult> {
    const data = await this.collectPluginsData();

    try {
      const { logEvent } = await import('@modules/services/analytics/index.js');
      logEvent('tengu_plugins_list', { total: data.total });
    } catch {
      // analytics 非关键
    }

    if (useJson) {
      return {
        success: true,
        message: JSON.stringify(data.plugins, null, 2),
      };
    }

    if (data.plugins.length === 0) {
      return { success: true, message: '当前没有已注册的插件' };
    }

    const lines: string[] = [`插件列表 (共 ${data.total} 个)\n`];

    for (const plugin of data.plugins) {
      lines.push(`  ${this.getStateIcon(plugin.state)} ${plugin.name}`);
      lines.push(`     版本: ${plugin.version}`);
      lines.push(`     状态: ${this.getStateText(plugin.state)}`);
      lines.push(`     路径: ${plugin.path}`);
      if (plugin.dependencies.length > 0) {
        lines.push(`     依赖: ${plugin.dependencies.join(', ')}`);
      }
      if (plugin.error) {
        lines.push(`     错误: ${plugin.error}`);
      }
      lines.push('');
    }

    return { success: true, message: lines.join('\n') };
  },

  /**
   * 测试插件连接
   */
  async testPlugins(useJson: boolean): Promise<CommandResult> {
    const data = await this.collectPluginsData();

    try {
      const { logEvent } = await import('@modules/services/analytics/index.js');
      logEvent('tengu_plugins_test', { total: data.total });
    } catch {
      // analytics 非关键
    }

    const results = data.plugins.map((p) => ({
      name: p.name,
      state: p.state,
      healthy: p.state === 'ACTIVATED' || p.state === 'LOADED',
      error: p.error || null,
    }));

    const healthy = results.filter((r) => r.healthy).length;
    const failed = results.filter((r) => !r.healthy).length;

    if (useJson) {
      return {
        success: true,
        message: JSON.stringify(
          { total: results.length, healthy, failed, results },
          null,
          2
        ),
      };
    }

    const lines: string[] = [
      '插件测试报告',
      '',
      `  总插件数: ${results.length}`,
      `  正常:     ${healthy}`,
      `  异常:     ${failed}`,
      '',
    ];

    for (const r of results) {
      const icon = r.healthy ? '✓' : '✗';
      lines.push(`  ${icon} ${r.name} - ${r.healthy ? '正常' : '异常'}`);
      if (r.error) {
        lines.push(`    错误: ${r.error}`);
      }
    }

    return { success: true, message: lines.join('\n') };
  },

  /**
   * 收集插件数据
   */
  async collectPluginsData(): Promise<PluginsData> {
    const plugins: PluginInfo[] = [];

    try {
      const { pluginSystem } = await import('@modules/plugins/index.js');

      const loadedPlugins = pluginSystem.getAllPlugins();
      const registrations = pluginSystem.getRegistry().getAllPlugins();

      if (registrations.length > 0) {
        for (const reg of registrations) {
          const loaded = loadedPlugins.find((lp: any) => lp.id === reg.id);
          plugins.push({
            name: reg.name,
            version: reg.version,
            state: reg.state,
            path: reg.path,
            dependencies: reg.dependencies || [],
            error: loaded?.error || undefined,
          });
        }
      }
    } catch {
      // 插件系统未初始化，使用插件管理器作为备选
      try {
        const { pluginManager } =
          await import('@modules/plugins/PluginManager.js');
        const allPlugins = pluginManager.getAllPlugins() || [];

        for (const plugin of allPlugins) {
          plugins.push({
            name: plugin.name,
            version: plugin.manifest?.version || '0.0.0',
            state: plugin.enabled ? 'ACTIVATED' : 'DEACTIVATED',
            path: plugin.path || '',
            dependencies: [],
            error: undefined,
          });
        }
      } catch {
        // 两个数据源都不可用，返回空数据
      }
    }

    return {
      plugins,
      total: plugins.length,
      enabledCount: plugins.filter(
        (p) => p.state === 'ACTIVATED' || p.state === 'LOADED'
      ).length,
      disabledCount: plugins.filter(
        (p) => p.state === 'DEACTIVATED' || p.state === 'UNLOADED'
      ).length,
      errorCount: plugins.filter((p) => p.state === 'FAILED').length,
    };
  },

  /**
   * 获取状态图标
   */
  getStateIcon(state: string): string {
    switch (state) {
      case 'ACTIVATED':
        return '●';
      case 'LOADED':
        return '◉';
      case 'DEACTIVATED':
        return '○';
      case 'FAILED':
        return '✕';
      case 'UNLOADED':
        return '◎';
      default:
        return '?';
    }
  },

  /**
   * 获取状态文本
   */
  getStateText(state: string): string {
    switch (state) {
      case 'ACTIVATED':
        return '已激活';
      case 'LOADED':
        return '已加载';
      case 'DEACTIVATED':
        return '已停用';
      case 'FAILED':
        return '失败';
      case 'UNLOADED':
        return '未加载';
      default:
        return '未知';
    }
  },
};

export default pluginsCommand;
