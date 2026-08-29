/**
 * Plugins命令实现
 * 插件管理和状态查看
 */
import type { CommandContext, CommandResult } from '@modules/commands';
import { getLogger } from '@modules/monitoring';
import { NpmDistributor } from '@modules/plugins';

const logger = getLogger('Plugins');

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

interface NpmPluginListEntry {
  name: string;
  version: string;
  capability: string;
  status: 'active' | 'inactive' | 'error';
  source: 'npm' | 'local' | 'bundled';
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
      const parts = args.trim().split(/\s+/);
      const firstArg = parts[0] || '';

      // 处理 npm 管理子命令
      if (firstArg === 'install') {
        return await installPlugin(parts[1] || '');
      }
      if (firstArg === 'remove' || firstArg === 'uninstall') {
        return await removePlugin(parts[1] || '');
      }
      if (firstArg === 'update') {
        return await updatePlugin(parts[1] || '');
      }
      if (firstArg === 'search') {
        return await searchPlugins(parts.slice(1).join(' '));
      }
      if (firstArg === 'load') {
        return await loadPluginCommand(parts[1] || '');
      }

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

      if (cleanArgs === 'list') {
        return await listNpmPlugins();
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
  /plugins install <name>    - 从 npm 安装插件
  /plugins remove <name>     - 移除已安装插件
  /plugins update [name]     - 更新插件（不指定名称则更新全部）
  /plugins search <query>    - 搜索插件
  /plugins load <name>       - 加载已安装的插件（发现+加载，幂等）
  /plugins help               - 显示此帮助

子命令说明:
  --list (-l)   列出所有已注册的插件及其基本信息
  --status (-s) 显示插件系统的状态概览和统计信息
  --test (-t)   测试所有插件的连接和状态检查
  status        显示插件系统总体状态（加载、启用、禁用等统计）
  install       从 npm 仓库安装插件
  remove        卸载已安装的插件
  update        更新指定插件或全部插件
  search        搜索可用的插件
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
    } catch (err) {
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
    } catch (err) {
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
    } catch (err) {
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
          const loaded = loadedPlugins.find((lp) => lp.id === reg.id);
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
    } catch (err) {
      // 插件系统未初始化，返回空数据
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

// ============================================================
// npm 插件管理功能（从 plugins/PluginCommand 合并）
// ============================================================

/**
 * 从 npm 安装插件
 */
async function installPlugin(name: string): Promise<CommandResult> {
  if (!name) {
    return {
      success: false,
      type: 'error',
      error: '请指定插件名称: /plugins install <name>',
    };
  }

  try {
    const distributor = new NpmDistributor();
    const result = await distributor.install(name);
    logger.info('插件安装结果', {
      name,
      success: result.success,
      version: result.version,
    });

    if (result.success) {
      // 2026-08-06 修复（Q1）：安装成功后尝试加载进插件系统（npm 包含 plugin.json 时成功）
      let loaded = false;
      try {
        const { pluginSystem } = await import('@modules/plugins');
        await pluginSystem.loadInstalledPlugins();
        const loadResult = await pluginSystem.loadPlugin(name);
        loaded = loadResult.success;
      } catch {
        loaded = false;
      }
      return {
        success: true,
        type: 'text',
        message: `插件 ${name} v${result.version} 安装成功${
          loaded ? '，已加载' : '（包未含 plugin.json，仅落盘）'
        }`,
        data: { ...result, loaded },
      };
    }

    return {
      success: false,
      type: 'error',
      error: `插件安装失败: ${result.error}`,
    };
  } catch (error) {
    logger.error('插件安装失败', error as Error);
    return {
      success: false,
      type: 'error',
      error: `插件安装失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 加载已安装的插件（发现 installed 目录 + 加载指定插件，幂等）
 * 2026-08-06 新增（Q1）：/plugins load <name>
 */
async function loadPluginCommand(name: string): Promise<CommandResult> {
  if (!name) {
    return {
      success: false,
      type: 'error',
      error: '请指定插件名称: /plugins load <name>',
    };
  }

  try {
    const { pluginSystem } = await import('@modules/plugins');
    // 先发现 installed 目录（幂等，仅首次执行），再加载指定插件
    await pluginSystem.loadInstalledPlugins();
    const result = await pluginSystem.loadPlugin(name);
    if (result.success) {
      return {
        success: true,
        type: 'text',
        message: `插件 ${name} 加载成功`,
        data: result,
      };
    }
    return {
      success: false,
      type: 'error',
      error: `插件加载失败: ${result.error || 'unknown'}`,
    };
  } catch (error) {
    logger.error('插件加载失败', error as Error);
    return {
      success: false,
      type: 'error',
      error: `插件加载失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 列出通过 npm 安装的插件
 */
async function listNpmPlugins(): Promise<CommandResult> {
  try {
    const distributor = new NpmDistributor();
    const installed = await distributor.listInstalled();
    const entries: NpmPluginListEntry[] = installed.map((p) => ({
      name: p.name,
      version: p.version || '?',
      capability: p.capability || 'tool',
      status: 'active' as const,
      source: 'npm' as const,
    }));

    const lines =
      entries.length === 0
        ? ['没有安装的 npm 插件']
        : entries.map(
            (e) => `  ${e.name} v${e.version} [${e.capability}] ${e.status}`
          );

    return {
      success: true,
      type: 'text',
      message: `已安装 npm 插件 (${entries.length}):\n${lines.join('\n')}`,
      data: entries,
    };
  } catch (error) {
    logger.error('列出 npm 插件失败', error as Error);
    return {
      success: false,
      type: 'error',
      error: `列出插件失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 移除已安装的插件
 */
async function removePlugin(name: string): Promise<CommandResult> {
  if (!name) {
    return {
      success: false,
      type: 'error',
      error: '请指定要移除的插件名称: /plugins remove <name>',
    };
  }

  try {
    const distributor = new NpmDistributor();
    const ok = await distributor.remove(name);
    logger.info('插件移除结果', { name, success: ok });
    return {
      success: ok,
      type: 'text',
      message: ok ? `插件 ${name} 已移除` : `插件 ${name} 移除失败`,
    };
  } catch (error) {
    logger.error('插件移除失败', error as Error);
    return {
      success: false,
      type: 'error',
      error: `插件移除失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 更新插件
 */
async function updatePlugin(name: string): Promise<CommandResult> {
  try {
    const distributor = new NpmDistributor();
    const target = name || 'all';
    const results = await distributor.update(target);
    const msgs = results.map(
      (r) => `  ${r.name}: ${r.success ? `v${r.version}` : r.error}`
    );
    return {
      success: results.every((r) => r.success),
      type: 'text',
      message: `更新结果:\n${msgs.join('\n')}`,
      data: results,
    };
  } catch (error) {
    logger.error('插件更新失败', error as Error);
    return {
      success: false,
      type: 'error',
      error: `插件更新失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 搜索插件
 * 2026-08-06 修复：桥接 PluginMarketplace 真实搜索（原实现仅返回提示文案）
 */
async function searchPlugins(query: string): Promise<CommandResult> {
  try {
    const { pluginMarketplace } = await import('@modules/plugins/marketplace');
    const result = pluginMarketplace.search({ query, page: 1, pageSize: 20 });

    if (result.plugins.length === 0) {
      return {
        success: true,
        type: 'text',
        message: `未找到与 "${query}" 匹配的插件。可运行 /plugins list 查看已安装插件。`,
      };
    }

    const lines = result.plugins.map(
      (p) =>
        `- ${p.name} — ${(p as { description?: string }).description || '无描述'}`
    );

    return {
      success: true,
      type: 'text',
      message: `找到 ${result.total} 个插件：\n${lines.join('\n')}`,
    };
  } catch (error) {
    return {
      success: false,
      type: 'error',
      error: `搜索失败: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export default pluginsCommand;
