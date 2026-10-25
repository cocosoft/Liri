/**
 * 插件设置命令实现（CLI）
 *
 * **唯一事实源**：`PluginConfigManager`（`~/.pyapp/plugins/config/config.json`）——
 * 与 HTTP `GET/PUT /v1/plugins/marketplace/plugins/:id/config` 共用同一套视图与校验
 * （`plugins/utils/pluginConfigValues.ts`），本文件不再自建存储。
 *
 * 历史（2026-10-26）：此前本命令读写 `~/.pyapp/settings.json` 的
 * `plugins.{repositories,enabled,disabled}`，与"插件配置项"无关；且 `writePluginConfig`
 * 只持久化这三键 ⇒ 用户刚 `set` 的 schema 键**写入即丢**（命令却回成功）。该面已移除。
 */
import type { CommandContext, CommandResult } from '@modules/commands';
import {
  buildPluginConfigView,
  extractPluginConfigSchema,
  pluginSystem,
  validatePluginConfigPatch,
} from '@modules/plugins';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('commands:plugin-settings:pluginSettings');

/** 已加载插件（避免额外 import 类型：直接用 `pluginSystem.getPlugin` 的返回类型） */
type LoadedPluginRef = NonNullable<ReturnType<typeof pluginSystem.getPlugin>>;

/**
 * 执行插件设置命令
 */
export async function executePluginSettings(
  args: string,
  _context: CommandContext
): Promise<CommandResult> {
  try {
    const params = parseArgs(args);

    if (!params.plugin) {
      return listAllPlugins();
    }

    const plugin = resolvePlugin(params.plugin);
    if (!plugin) {
      return fail(
        `插件 "${params.plugin}" 未找到（仅已加载插件可查；未加载的插件请先在插件市场启用）`
      );
    }

    switch (params.action) {
      case 'get':
        return getSetting(plugin, params.key);

      case 'set':
        return setSetting(plugin, params.key, params.value);

      case 'reset':
        return resetSettings(plugin);

      case 'list':
      default:
        return listSettings(plugin);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn('plugin-settings 命令执行失败', { error: errorMessage });
    return {
      type: 'error',
      success: false,
      message: `插件设置命令执行失败: ${errorMessage}`,
    };
  }
}

/** 按 id 或名称（含清单名）解析已加载插件 */
function resolvePlugin(nameOrId: string): LoadedPluginRef | undefined {
  const byId = pluginSystem.getPlugin(nameOrId);
  if (byId) return byId;
  return pluginSystem
    .getAllPlugins()
    .find(
      (plugin) => plugin.name === nameOrId || plugin.manifest?.name === nameOrId
    );
}

/** 读该插件的配置视图（schema + 已存储值） */
function viewOf(plugin: LoadedPluginRef) {
  return buildPluginConfigView(
    plugin.id,
    extractPluginConfigSchema(plugin.manifest),
    pluginSystem.getPluginConfig(plugin.id) as Record<string, unknown>
  );
}

function fail(message: string): CommandResult {
  return { type: 'text', success: false, message };
}

/**
 * 列出所有已加载插件的配置概况
 */
function listAllPlugins(): CommandResult {
  const plugins = pluginSystem.getAllPlugins();

  if (plugins.length === 0) {
    return { type: 'text', success: true, message: '没有已加载的插件' };
  }

  const lines: string[] = ['已加载插件及其配置状态:\n'];
  for (const plugin of plugins) {
    const view = viewOf(plugin);
    const setCount = view.items.filter((item) => item.isSet).length;
    lines.push(`  ${plugin.name} (${plugin.id})`);
    if (view.items.length > 0) {
      lines.push(`    配置项: ${view.items.length}（已设置 ${setCount}）`);
    }
  }

  return { type: 'text', success: true, message: lines.join('\n') };
}

/**
 * 读取单个配置项或全部配置项
 */
function getSetting(plugin: LoadedPluginRef, key?: string): CommandResult {
  const view = viewOf(plugin);

  if (key) {
    const item = view.items.find((i) => i.key === key);
    if (!item) {
      if (view.items.length > 0) {
        return fail(
          `配置项 "${key}" 不存在，可用配置项: ${view.items.map((i) => i.key).join(', ')}`
        );
      }
      const raw = view.values[key];
      return raw === undefined
        ? fail(`插件 "${plugin.name}" 没有配置项 "${key}"`)
        : {
            type: 'text',
            success: true,
            message: `${plugin.name}.${key} = ${JSON.stringify(raw)}`,
          };
    }

    const suffix = item.isSet ? '' : '（默认值）';
    return {
      type: 'text',
      success: true,
      message: `${plugin.name}.${key} = ${JSON.stringify(item.value)}${suffix}`,
    };
  }

  if (view.items.length === 0) {
    const entries = Object.entries(view.values);
    return {
      type: 'text',
      success: true,
      message:
        entries.length === 0
          ? `插件 "${plugin.name}" 没有已存储的配置`
          : `${plugin.name} 已存储配置:\n${entries
              .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
              .join('\n')}`,
    };
  }

  return {
    type: 'text',
    success: true,
    message: `${plugin.name} 设置:\n${view.items
      .map(
        (item) =>
          `  ${item.key}: ${JSON.stringify(item.value)}${item.isSet ? '' : '（默认值）'}`
      )
      .join('\n')}`,
  };
}

/**
 * 设置单个配置项（校验与 HTTP 写入同口径）
 */
function setSetting(
  plugin: LoadedPluginRef,
  key?: string,
  value?: string
): CommandResult {
  if (!key) return fail('请指定要设置的配置项键名');
  if (value === undefined) return fail('请指定配置项的值');

  const schema = extractPluginConfigSchema(plugin.manifest);
  const view = viewOf(plugin);
  const item = view.items.find((i) => i.key === key);

  if (view.items.length > 0 && !item) {
    return fail(
      `配置项 "${key}" 不存在，可用配置项: ${view.items.map((i) => i.key).join(', ')}`
    );
  }

  let parsedValue: unknown;
  if (item?.type === 'boolean') {
    parsedValue = value === 'true' || value === '1';
  } else if (item?.type === 'number') {
    parsedValue = Number(value);
    if (Number.isNaN(parsedValue as number)) {
      return fail(`值 "${value}" 不是有效的数字`);
    }
  } else {
    try {
      parsedValue = JSON.parse(value);
    } catch {
      parsedValue = value;
    }
  }

  const patch = { [key]: parsedValue };
  const result = validatePluginConfigPatch(schema, view.values, patch);
  if (!result.ok) {
    return fail(`配置验证失败: ${result.errors.join('; ')}`);
  }

  pluginSystem.setPluginConfig(plugin.id, { ...view.values, ...result.values });

  return {
    type: 'text',
    success: true,
    message: `已设置 ${plugin.name}.${key} = ${JSON.stringify(parsedValue)}`,
  };
}

/**
 * 列出插件的全部配置项（类型 / 描述 / 选项 / 当前值 / 默认值）
 */
function listSettings(plugin: LoadedPluginRef): CommandResult {
  const view = viewOf(plugin);

  if (view.items.length === 0) {
    return {
      type: 'text',
      success: true,
      message: `插件 "${plugin.name}" 没有声明 configSchema（无可配置项）`,
    };
  }

  const lines: string[] = [`${plugin.name} 配置项:\n`];
  for (const item of view.items) {
    lines.push(`  ${item.key}`);
    lines.push(`    类型: ${item.type}`);
    lines.push(`    描述: ${item.description || '无'}`);
    if (item.required) lines.push('    必填: 是');
    if (item.options) {
      lines.push(
        `    选项: ${item.options.map((o) => `${o.label}(${o.value})`).join(', ')}`
      );
    }
    lines.push(
      `    当前值: ${JSON.stringify(item.value)}${item.isSet ? '' : '（默认值）'}`
    );
    if (item.default !== undefined) {
      lines.push(`    默认值: ${JSON.stringify(item.default)}`);
    }
    lines.push('');
  }

  return { type: 'text', success: true, message: lines.join('\n') };
}

/**
 * 重置该插件的配置（清空已存储值；默认值由 schema 决定）
 */
function resetSettings(plugin: LoadedPluginRef): CommandResult {
  pluginSystem.getConfigManager().resetConfig(plugin.id);

  return {
    type: 'text',
    success: true,
    message: `已重置 ${plugin.name} 的所有配置（回到清单默认值）`,
  };
}

/**
 * 解析命令参数：`<plugin> [get|set|list|reset] [key] [value...]`
 */
function parseArgs(args: string): {
  plugin?: string;
  action?: string;
  key?: string;
  value?: string;
} {
  const parts = args.trim().split(/\s+/);

  return {
    plugin: parts[0] || undefined,
    action: parts[1] || undefined,
    key: parts[2] || undefined,
    value: parts.slice(3).join(' ') || undefined,
  };
}
