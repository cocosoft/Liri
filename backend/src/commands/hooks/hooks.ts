/**
 * Hooks命令执行逻辑
 * 查看和管理工具事件hooks
 * 参考CC源码 cc_code/backend/commands/hooks/hooks.tsx 实现
 */

import type { CommandContext, CommandResult } from '@modules/commands/types';

/**
 * Hook配置
 */
interface HookConfig {
  tool: string;
  event: string;
  command: string;
  enabled: boolean;
}

/**
 * 获取hook配置
 */
function getHookConfigs(): HookConfig[] {
  // 从环境变量或配置文件中读取hook配置
  const hooksEnv = process.env.PY_APP_HOOKS;

  if (hooksEnv) {
    try {
      return JSON.parse(hooksEnv);
    } catch {
      // 解析失败，返回默认配置
    }
  }

  // 返回默认配置
  return [
    {
      tool: 'BashTool',
      event: 'beforeExecute',
      command: 'echo "Executing bash command..."',
      enabled: false,
    },
    {
      tool: 'FileWriteTool',
      event: 'afterExecute',
      command: 'echo "File written successfully"',
      enabled: false,
    },
  ];
}

/**
 * 执行hooks命令
 */
export async function executeHooks(
  args: string,
  _context: CommandContext
): Promise<CommandResult> {
  try {
    const params = parseHooksArgs(args);
    const configs = getHookConfigs();

    // 如果指定了工具名，显示该工具的hooks
    if (params.tool) {
      const toolHooks = configs.filter((h) => h.tool === params.tool);

      if (toolHooks.length === 0) {
        return {
          type: 'text',
          success: true,
          message: `工具 ${params.tool} 没有配置hooks`,
        };
      }

      return {
        type: 'text',
        success: true,
        message: `工具 ${params.tool} 的hooks:\n${toolHooks
          .map(
            (h) =>
              `  - ${h.event}: ${h.command} (${h.enabled ? '启用' : '禁用'})`
          )
          .join('\n')}`,
      };
    }

    // 显示所有hooks
    if (configs.length === 0) {
      return {
        type: 'text',
        success: true,
        message: '没有配置hooks',
      };
    }

    // 按工具分组显示
    const grouped = configs.reduce((acc, hook) => {
      if (!acc[hook.tool]) {
        acc[hook.tool] = [];
      }
      acc[hook.tool].push(hook);
      return acc;
    }, {} as Record<string, HookConfig[]>);

    const output = Object.entries(grouped)
      .map(([tool, hooks]) => {
        const hooksList = hooks
          .map(
            (h) =>
              `    - ${h.event}: ${h.command} (${h.enabled ? '启用' : '禁用'})`
          )
          .join('\n');
        return `  ${tool}:\n${hooksList}`;
      })
      .join('\n\n');

    return {
      type: 'text',
      success: true,
      message: `已配置的hooks:\n\n${output}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      type: 'error',
      success: false,
      message: `查看hooks失败: ${errorMessage}`,
    };
  }
}

/**
 * 解析hooks命令参数
 */
function parseHooksArgs(args: string): {
  tool?: string;
} {
  const params: {
    tool?: string;
  } = {};

  if (!args) return params;

  const parts = args.trim().split(/\s+/);

  for (const part of parts) {
    if (!part.startsWith('-')) {
      params.tool = part;
      break;
    }
  }

  return params;
}
