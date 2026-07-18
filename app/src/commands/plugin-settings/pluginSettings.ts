/**
 * 插件设置命令实现
 * 提供插件配置管理功能
 */

import type { CommandContext, CommandResult } from '@modules/commands';
import { PluginRegistry } from '@modules/plugins/core/PluginRegistry.js';
import {
  readPluginConfig,
  writePluginConfig,
} from '@modules/plugins/utils/pluginSettings.js';
import {
  validatePluginConfig,
  mergeWithDefaults,
} from '@modules/plugins/utils/pluginConfigSchema.js';
import type { PluginConfigSchema } from '@modules/plugins/utils/pluginConfigSchema.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'commands:plugin-settings:pluginSettings', level: LogLevel.INFO });

const pluginRegistry = new PluginRegistry();

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
      return listAllPluginSettings();
    }

    const plugin = pluginRegistry.getPlugin(params.plugin);

    if (!plugin) {
      return {
        type: 'text',
        success: false,
        message: `插件 "${params.plugin}" 未找到`,
      };
    }

    switch (params.action) {
      case 'get':
        return getPluginSetting(plugin.name, params.key);

      case 'set':
        return setPluginSetting(plugin.name, params.key!, params.value);

      case 'list':
        return listPluginSettings(plugin.name);

      case 'reset':
        return resetPluginSettings(plugin.name);

      default:
        return listPluginSettings(plugin.name);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      type: 'error',
      success: false,
      message: `插件设置命令执行失败: ${errorMessage}`,
    };
  }
}

/**
 * 列出所有插件的设置
 */
function listAllPluginSettings(): CommandResult {
  const plugins = pluginRegistry.getAllPlugins();

  if (plugins.length === 0) {
    return {
      type: 'text',
      success: true,
      message: '没有已安装的插件',
    };
  }

  const lines: string[] = ['已安装的插件及其设置状态:\n'];

  for (const plugin of plugins) {
    const settings = readPluginConfig();
    const configSchema = plugin.manifest?.configSchema as
      | PluginConfigSchema
      | undefined;
    const itemCount = configSchema?.items?.length || 0;
    const hasSettings = Object.keys(settings).length > 0;

    lines.push(`  ${plugin.name} ${plugin.enabled ? '●' : '○'}`);
    if (itemCount > 0) {
      lines.push(`    配置项: ${itemCount}`);
      lines.push(`    已配置: ${hasSettings ? '是' : '否'}`);
    }
  }

  return {
    type: 'text',
    success: true,
    message: lines.join('\n'),
  };
}

/**
 * 获取插件的单个设置
 */
function getPluginSetting(pluginName: string, key?: string): CommandResult {
  const settings = readPluginConfig();
  const plugin = pluginRegistry.getPlugin(pluginName);

  if (!plugin) {
    return {
      type: 'text',
      success: false,
      message: `插件 "${pluginName}" 未找到`,
    };
  }

  const configSchema = plugin.manifest?.configSchema as
    | PluginConfigSchema
    | undefined;

  if (key) {
    const settingValue = (settings as Record<string, unknown>)[key];
    if (settingValue === undefined) {
      const defaultValue = configSchema?.items?.find(
        (i) => i.key === key
      )?.default;
      return {
        type: 'text',
        success: true,
        message: `${pluginName}.${key} = (未设置, 默认值: ${JSON.stringify(defaultValue)})`,
      };
    }

    return {
      type: 'text',
      success: true,
      message: `${pluginName}.${key} = ${JSON.stringify(settingValue)}`,
    };
  }

  const output: string[] = [];
  if (configSchema?.items) {
    for (const item of configSchema.items) {
      const value =
        (settings as Record<string, unknown>)[item.key] ?? item.default;
      output.push(`  ${item.key}: ${JSON.stringify(value)}`);
    }
  } else {
    for (const [k, v] of Object.entries(settings)) {
      output.push(`  ${k}: ${JSON.stringify(v)}`);
    }
  }

  return {
    type: 'text',
    success: true,
    message: `${pluginName} 设置:\n${output.join('\n')}`,
  };
}

/**
 * 设置插件配置项的值
 */
function setPluginSetting(
  pluginName: string,
  key: string,
  value?: string
): CommandResult {
  if (!key) {
    return {
      type: 'text',
      success: false,
      message: '请指定要设置的配置项键名',
    };
  }

  if (value === undefined) {
    return {
      type: 'text',
      success: false,
      message: '请指定配置项的值',
    };
  }

  const plugin = pluginRegistry.getPlugin(pluginName);

  if (!plugin) {
    return {
      type: 'text',
      success: false,
      message: `插件 "${pluginName}" 未找到`,
    };
  }

  const configSchema = plugin.manifest?.configSchema as
    | PluginConfigSchema
    | undefined;
  const configItem = configSchema?.items?.find((i) => i.key === key);

  if (configSchema?.items && !configItem) {
    return {
      type: 'text',
      success: false,
      message: `配置项 "${key}" 不存在，可用配置项: ${configSchema.items.map((i) => i.key).join(', ')}`,
    };
  }

  let parsedValue: unknown;
  try {
    if (configItem?.type === 'boolean') {
      parsedValue = value === 'true' || value === '1';
    } else if (configItem?.type === 'number') {
      parsedValue = Number(value);
      if (isNaN(parsedValue as number)) {
        return {
          type: 'text',
          success: false,
          message: `值 "${value}" 不是有效的数字`,
        };
      }
    } else {
      try {
        parsedValue = JSON.parse(value);
      } catch {
        parsedValue = value;
      }
    }
  } catch {
    return {
      type: 'text',
      success: false,
      message: `无法解析值 "${value}"`,
    };
  }

  const settings = readPluginConfig();
  const mergedSettings = mergeWithDefaults(configSchema!, {
    ...settings,
    [key]: parsedValue,
  });

  const validation = validatePluginConfig(configSchema!, mergedSettings);
  if (!validation.valid) {
    return {
      type: 'text',
      success: false,
      message: `配置验证失败: ${validation.errors.map((e) => e.message).join(', ')}`,
    };
  }

  writePluginConfig(undefined, mergedSettings as Record<string, unknown>);

  return {
    type: 'text',
    success: true,
    message: `已设置 ${pluginName}.${key} = ${JSON.stringify(parsedValue)}`,
  };
}

/**
 * 列出插件的所有配置项
 */
function listPluginSettings(pluginName: string): CommandResult {
  const plugin = pluginRegistry.getPlugin(pluginName);

  if (!plugin) {
    return {
      type: 'text',
      success: false,
      message: `插件 "${pluginName}" 未找到`,
    };
  }

  const settings = readPluginConfig();
  const configSchema = plugin.manifest?.configSchema as
    | PluginConfigSchema
    | undefined;

  if (!configSchema?.items || configSchema.items.length === 0) {
    return {
      type: 'text',
      success: true,
      message: `${pluginName} 没有可配置的选项`,
    };
  }

  const lines: string[] = [`${pluginName} 配置项:\n`];

  for (const item of configSchema.items) {
    const value =
      (settings as Record<string, unknown>)[item.key] ?? item.default;
    lines.push(`  ${item.key}`);
    lines.push(`    类型: ${item.type}`);
    lines.push(`    描述: ${item.description || '无'}`);
    if (item.required) {
      lines.push(`    必填: 是`);
    }
    if (item.options) {
      lines.push(
        `    选项: ${item.options.map((o) => `${o.label}(${o.value})`).join(', ')}`
      );
    }
    lines.push(`    当前值: ${JSON.stringify(value)}`);
    if (item.default !== undefined) {
      lines.push(`    默认值: ${JSON.stringify(item.default)}`);
    }
    lines.push('');
  }

  return {
    type: 'text',
    success: true,
    message: lines.join('\n'),
  };
}

/**
 * 重置插件设置为默认值
 */
function resetPluginSettings(pluginName: string): CommandResult {
  const plugin = pluginRegistry.getPlugin(pluginName);

  if (!plugin) {
    return {
      type: 'text',
      success: false,
      message: `插件 "${pluginName}" 未找到`,
    };
  }

  writePluginConfig(undefined, { repositories: {}, enabled: [], disabled: [] });

  return {
    type: 'text',
    success: true,
    message: `已重置 ${pluginName} 的所有设置为默认值`,
  };
}

/**
 * 解析命令参数
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
