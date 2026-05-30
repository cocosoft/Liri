/**
 * 插件 CLI 命令
 * Liri plugin install/list/remove/update
 */

import type {
  Command,
  CommandContext,
  CommandResult,
} from '@modules/commands/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { NpmDistributor } from '@modules/plugins/distribution/NpmDistributor';

const logger = new Logger({ level: LogLevel.INFO });

interface PluginListEntry {
  name: string;
  version: string;
  capability: string;
  status: 'active' | 'inactive' | 'error';
  source: 'npm' | 'local' | 'bundled';
}

const pluginsCmd: Command = {
  type: 'local',
  name: 'plugin',
  description: 'Manage plugins (install/list/remove/update)',
  aliases: ['plugins'],
  loadedFrom: 'builtin',
  disableModelInvocation: true,
  userInvocable: true,
  argumentHint: '<action> [name]',

  async load() {
    return {
      async execute(
        args: string,
        _ctx?: CommandContext
      ): Promise<CommandResult> {
        const parts = args.trim().split(/\s+/);
        const action = parts[0] || 'list';
        const name = parts[1] || '';

        try {
          switch (action) {
            case 'install':
              return installPlugin(name);
            case 'list':
              return listPlugins();
            case 'remove':
            case 'uninstall':
              return removePlugin(name);
            case 'update':
              return updatePlugin(name);
            case 'search':
              return searchPlugins(name);
            default:
              return listPlugins();
          }
        } catch (error) {
          logger.error('插件命令失败', error as Error);
          return {
            success: false,
            type: 'error',
            error: `插件操作失败: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    };
  },
};

async function installPlugin(name: string): Promise<CommandResult> {
  if (!name) {
    return {
      success: false,
      type: 'error',
      error: '请指定插件名称: Liri plugin install <name>',
    };
  }
  const distributor = new NpmDistributor();
  const result = await distributor.install(name);
  return {
    success: result.success,
    type: 'text',
    message: result.success
      ? `插件 ${name} v${result.version} 安装成功`
      : `插件安装失败: ${result.error}`,
    data: result,
  };
}

async function listPlugins(): Promise<CommandResult> {
  const distributor = new NpmDistributor();
  const installed = await distributor.listInstalled();
  const entries: PluginListEntry[] = installed.map((p) => ({
    name: p.name,
    version: p.version || '?',
    capability: p.capability || 'tool',
    status: 'active' as const,
    source: 'npm' as const,
  }));
  const lines =
    entries.length === 0
      ? ['没有安装的插件']
      : entries.map(
          (e) => `  ${e.name} v${e.version} [${e.capability}] ${e.status}`
        );
  return {
    success: true,
    type: 'text',
    message: `已安装插件 (${entries.length}):\n${lines.join('\n')}`,
    data: entries,
  };
}

async function removePlugin(name: string): Promise<CommandResult> {
  if (!name) {
    return { success: false, type: 'error', error: '请指定要移除的插件名称' };
  }
  const distributor = new NpmDistributor();
  const ok = await distributor.remove(name);
  return {
    success: ok,
    type: 'text',
    message: ok ? `插件 ${name} 已移除` : `插件 ${name} 移除失败`,
  };
}

async function updatePlugin(name: string): Promise<CommandResult> {
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
}

async function searchPlugins(query: string): Promise<CommandResult> {
  return {
    success: true,
    type: 'text',
    message: `搜索: "${query}" — 请访问 npm registry 或 PyAPP Hub 搜索插件`,
  };
}

export default pluginsCmd;
