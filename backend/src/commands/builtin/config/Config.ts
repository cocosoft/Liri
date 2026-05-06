// @ts-nocheck
import type { CommandContext } from '@modules/commands/types';
import { getToolManager } from '../../../tools/ToolManager';

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
        value: result.output,
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
        value: result.output,
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

    const result = await configTool.execute({ action: 'set', key, value }, {} as any);

    if (result.success) {
      return {
        type: 'text',
        value: result.output,
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
        value: result.output,
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
    default:
      return {
        type: 'text',
        value: `配置命令用法:\n\n/config list - 列出所有配置\n/config get <键> - 获取配置值\n/config set <键> <值> - 设置配置值\n/config reset <键> - 重置配置值`,
      };
  }
};

export default {
  call,
};
