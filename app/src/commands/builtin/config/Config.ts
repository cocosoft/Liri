//
import type { CommandContext } from '@modules/commands';
import { getToolManager } from '@modules/tools/ToolManager';
import { ConfigDocGenerator, configSchema } from '@modules/config/schema';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'commands:builtin:config:Config', level: LogLevel.INFO });

const listConfig = async (): Promise<{ type: 'text'; value: string }> => {
  try {
    const toolManager = getToolManager();
    const configTool = toolManager.getTool('config');

    if (!configTool) {
      return {
        type: 'text',
        value: '错误: Config工具未找到',
      };
    }

    const result = await configTool.execute({ action: 'list' }, {} as any);

    if (result.success) {
      return {
        type: 'text',
        value: result.output!,
      };
    } else {
      return {
        type: 'text',
        value: `错误: ${result.error || '获取配置失败'}`,
      };
    }
  } catch (error) {
    return {
      type: 'text',
      value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
};

const getConfig = async (
  key: string
): Promise<{ type: 'text'; value: string }> => {
  if (!key) {
    return {
      type: 'text',
      value: '请提供配置键: /config get <键>',
    };
  }

  try {
    const toolManager = getToolManager();
    const configTool = toolManager.getTool('config');

    if (!configTool) {
      return {
        type: 'text',
        value: '错误: Config工具未找到',
      };
    }

    const result = await configTool.execute({ action: 'get', key }, {} as any);

    if (result.success) {
      return {
        type: 'text',
        value: result.output!,
      };
    } else {
      return {
        type: 'text',
        value: `错误: ${result.error || '获取配置失败'}`,
      };
    }
  } catch (error) {
    return {
      type: 'text',
      value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
};

const setConfig = async (
  key: string,
  value: string
): Promise<{ type: 'text'; value: string }> => {
  if (!key || !value) {
    return {
      type: 'text',
      value: '请提供配置键和值: /config set <键> <值>',
    };
  }

  try {
    const toolManager = getToolManager();
    const configTool = toolManager.getTool('config');

    if (!configTool) {
      return {
        type: 'text',
        value: '错误: Config工具未找到',
      };
    }

    const result = await configTool.execute(
      { action: 'set', key, value },
      {} as any
    );

    if (result.success) {
      return {
        type: 'text',
        value: result.output!,
      };
    } else {
      return {
        type: 'text',
        value: `错误: ${result.error || '设置配置失败'}`,
      };
    }
  } catch (error) {
    return {
      type: 'text',
      value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
};

const docsConfig = async (
  subCmd: string,
  outputPath?: string
): Promise<{ type: 'text'; value: string }> => {
  const generator = new ConfigDocGenerator(configSchema);

  if (subCmd === 'save' && outputPath) {
    try {
      const resolved = outputPath;
      generator.generateToFile(resolved);
      return {
        type: 'text',
        value: `配置文档已生成到: ${resolved}`,
      };
    } catch (error) {
      return {
        type: 'text',
        value: `生成文档失败: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  }

  if (subCmd === 'item' && outputPath) {
    const detail = generator.generateItemDetail(outputPath);
    if (detail) {
      return { type: 'text', value: detail };
    }
    return { type: 'text', value: `未找到配置项: ${outputPath}` };
  }

  const summary = generator.generateSummary();
  if (subCmd === 'full') {
    const full = generator.generateMarkdown({ showExamples: true });
    return { type: 'text', value: full };
  }

  return { type: 'text', value: summary };
};

const resetConfig = async (
  key: string
): Promise<{ type: 'text'; value: string }> => {
  if (!key) {
    return {
      type: 'text',
      value: '请提供配置键: /config reset <键>',
    };
  }

  try {
    const toolManager = getToolManager();
    const configTool = toolManager.getTool('config');

    if (!configTool) {
      return {
        type: 'text',
        value: '错误: Config工具未找到',
      };
    }

    const result = await configTool.execute({ action: 'reset' }, {} as any);

    if (result.success) {
      return {
        type: 'text',
        value: result.output!,
      };
    } else {
      return {
        type: 'text',
        value: `错误: ${result.error || '重置配置失败'}`,
      };
    }
  } catch (error) {
    return {
      type: 'text',
      value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
};

const call = async (
  args: string,
  _context: CommandContext
): Promise<{ type: 'text'; value: string }> => {
  const parts = args.split(' ');
  const subCommand = parts[0];
  const key = parts[1];
  const value = parts.slice(2).join(' ');

  switch (subCommand) {
    case 'list':
      return await listConfig();
    case 'get':
      return await getConfig(key);
    case 'set':
      return await setConfig(key, value);
    case 'reset':
      return await resetConfig(key);
    case 'docs':
      return await docsConfig(key, value);
    default:
      return {
        type: 'text',
        value: `配置命令用法:\n\n/config list - 列出所有配置\n/config get <键> - 获取配置值\n/config set <键> <值> - 设置配置值\n/config reset <键> - 重置配置值\n/config docs [full|save|item] - 配置文档`,
      };
  }
};

export default {
  call,
};
