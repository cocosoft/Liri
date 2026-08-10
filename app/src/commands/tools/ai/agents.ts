/**
 * agent-instance 命令
 *
 * 功能: 管理 Agent 实例（命名的 Agent 配置，可通过工具管理器发现）
 * CC 中 AgentTool 为单例，通过内置 Agent 定义和 .md 文件管理不同类型的子代理；
 * Liri 在此基础上支持运行时注册命名 Agent 实例，便于模型识别和调用不同配置的 Agent。
 *
 * 子命令:
 *   list                    - 列出所有 Agent 实例和活跃子代理
 *   create <name> [--type]  - 创建新的 Agent 实例
 *   delete <name|id>        - 删除 Agent 实例
 *   help                    - 显示帮助
 */

import type { Command } from '@modules/commands';
import { getToolManager } from '@modules/tools/ToolManager.js';
import { AgentTool } from '@modules/tools/AgentTool/AgentTool.js';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('commands:tools:ai:agents');

/** 可用的 Agent 类型列表 */
const AGENT_TYPES = [
  'general',
  'explore',
  'plan',
  'verification',
  'code-guide',
  'statusline-setup',
] as const;

/** 子命令列表 */
const SUBCOMMANDS = ['list', 'create', 'delete', 'help'] as const;

/** Agent 实例配置 */
interface AgentInstance {
  name: string;
  type: string;
  createdAt: number;
  status: 'idle';
}

/** 注册的 Agent 实例存储 */
const agentInstances = new Map<string, AgentInstance>();

/**
 * 格式化持续时间
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * 从工具管理器获取 AgentTool 实例
 */
function getAgentTool(): AgentTool | null {
  try {
    const toolManager = getToolManager();
    const tool = toolManager.getTool('Agent');
    if (tool instanceof AgentTool) {
      return tool;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 构建帮助文本
 */
function buildHelpText(): string {
  return [
    'Agent-Instance 命令帮助',
    '═══════════════════════',
    '',
    '用法:',
    '  /agent-instance list                    - 列出所有 Agent 实例',
    '  /agent-instance list --json             - 以 JSON 格式输出',
    '  /agent-instance create <name> [--type]  - 创建新的 Agent 实例',
    '  /agent-instance delete <name|id>        - 删除 Agent 实例',
    '',
    '参数:',
    '  name             实例名称（必填）',
    '  --type <type>    实例类型（可选，默认: general）',
    '  --json           以 JSON 格式输出（仅 list）',
    '',
    '可用类型:',
    `  ${AGENT_TYPES.join(', ')}`,
    '',
    '使用示例:',
    '  /agent-instance list',
    '  /agent-instance list --json',
    '  /agent-instance create my-explorer --type explore',
    '  /agent-instance create code-reviewer',
    '  /agent-instance delete my-explorer',
    '',
    '别名: /agents_tool',
    '',
    '━━━ 相关命令对比 ━━━',
    '',
    '  /agent-instance（当前） - Agent 实例管理器：',
    '                           创建/删除命名的 Agent 实例配置',
    '',
    '  /subagent              - 子代理配置管理器：',
    '                           查看/创建/删除子代理定义（.md 配置文件）',
    '',
    '  /subagent-run          - 子代理任务执行器：',
    '                           运行/查看/停止子代理的执行任务',
    '',
    '使用建议：',
    '  - 管理 Agent 实例   → 使用 /agent-instance',
    '  - 日常运行子代理任务 → 使用 /subagent-run',
    '  - 管理子代理配置     → 使用 /subagent',
  ].join('\n');
}

/**
 * 获取 AI 模型提示
 */
function getPromptForCommand(): Promise<Array<{ type: 'text'; text: string }>> {
  return Promise.resolve([
    {
      type: 'text',
      text: [
        '## agent-instance 命令',
        '',
        '管理命名的 Agent 实例。支持以下操作：',
        '',
        '1. **list** - 列出所有已注册的 Agent 实例和当前活跃的子代理任务',
        '2. **create <name> [--type <type>]** - 创建并注册新的 Agent 实例',
        '3. **delete <name|id>** - 删除 Agent 实例或停止运行中的子代理',
        '',
        '可用类型：general, explore, plan, verification, code-guide, statusline-setup',
        '',
        '示例：',
        '  /agent-instance list',
        '  /agent-instance create my-analyzer --type explore',
        '  /agent-instance delete my-analyzer',
      ].join('\n'),
    },
  ]);
}

/**
 * 处理 list 子命令
 */
async function handleList(
  options: { json?: boolean } = {}
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const agentTool = getAgentTool();
    const activeAgents = agentTool?.getActiveAgents() || [];
    const toolManager = getToolManager();

    const allTools = toolManager.getAllTools();
    const agentTools = allTools.filter((t) =>
      t.name.toLowerCase().includes('agent')
    );

    if (options.json) {
      const data = {
        registeredInstances: Array.from(agentInstances.values()),
        activeAgents,
        agentTools: agentTools.map((t) => ({
          name: t.name,
          description: t.description,
        })),
      };
      return {
        success: true,
        message: JSON.stringify(data, null, 2),
      };
    }

    const lines: string[] = ['Agent 实例列表', '═══════════════', ''];

    if (agentInstances.size > 0) {
      lines.push('已注册实例:');
      for (const [name, instance] of agentInstances) {
        const age = formatDuration(Date.now() - instance.createdAt);
        lines.push(
          `  ${name}  type=${instance.type}  status=${instance.status}  created=${age} ago`
        );
      }
      lines.push('');
    }

    if (agentTools.length > 0) {
      lines.push('工具管理器中的 Agent 工具:');
      for (const t of agentTools) {
        lines.push(`  ${t.name}  -  ${t.description}`);
      }
      lines.push('');
    }

    if (activeAgents.length > 0) {
      lines.push('运行中的子代理:');
      for (const agent of activeAgents) {
        const duration = formatDuration(Date.now() - agent.startTime);
        lines.push(
          `  ${agent.id}  ${agent.name}  type=${agent.type}  status=${agent.status}  running=${duration}`
        );
      }
      lines.push('');
    }

    if (
      agentInstances.size === 0 &&
      agentTools.length === 0 &&
      activeAgents.length === 0
    ) {
      lines.push('暂无 Agent 实例');
      lines.push('');
      lines.push(
        '使用 /agent-instance create <name> [--type <type>] 创建新实例'
      );
    }

    return { success: true, message: lines.join('\n') };
  } catch (error) {
    return {
      success: false,
      error: `列出 Agent 时出错: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * 处理 create 子命令
 */
async function handleCreate(
  args: string[]
): Promise<{ success: boolean; message?: string; error?: string }> {
  const typeIndex = args.indexOf('--type');
  const name = typeIndex >= 0 ? args[1] : args[1];
  const agentType = typeIndex >= 0 ? args[typeIndex + 1] : args[2] || 'general';

  if (!name) {
    return {
      success: false,
      error:
        '请指定 Agent 实例名称\n用法: /agent-instance create <name> [--type <type>]',
    };
  }

  if (
    !AGENT_TYPES.includes(agentType as unknown as (typeof AGENT_TYPES)[number])
  ) {
    return {
      success: false,
      error: `无效的 Agent 类型: "${agentType}"\n可用类型: ${AGENT_TYPES.join(', ')}`,
    };
  }

  if (agentInstances.has(name)) {
    return {
      success: false,
      error: `Agent 实例 "${name}" 已存在\n使用 /agent-instance delete ${name} 删除后重新创建`,
    };
  }

  const instance: AgentInstance = {
    name,
    type: agentType,
    createdAt: Date.now(),
    status: 'idle',
  };

  agentInstances.set(name, instance);

  return {
    success: true,
    message: [
      `Agent 实例已创建`,
      `名称: ${name}`,
      `类型: ${agentType}`,
      '',
      `使用 /subagent-run run --agent ${name} <task> 运行任务`,
    ].join('\n'),
  };
}

/**
 * 处理 delete 子命令
 */
async function handleDelete(
  args: string[]
): Promise<{ success: boolean; message?: string; error?: string }> {
  const name = args[1];

  if (!name) {
    return {
      success: false,
      error:
        '请指定 Agent 实例名称或 ID\n用法: /agent-instance delete <name|id>',
    };
  }

  if (agentInstances.has(name)) {
    agentInstances.delete(name);
    return {
      success: true,
      message: `Agent 实例 "${name}" 已删除`,
    };
  }

  const agentTool = getAgentTool();
  if (agentTool) {
    const stopped = agentTool.stopAgent(name);
    if (stopped) {
      return {
        success: true,
        message: `运行中的子代理 ${name} 已停止`,
      };
    }
  }

  return {
    success: false,
    error: `未找到 Agent 实例或运行中的子代理: ${name}\n使用 /agent-instance list 查看可用实例`,
  };
}

/**
 * Agents命令
 */
export const agentsCommand: Command = {
  type: 'action',
  name: 'agent-instance',
  description: '管理多个Agent实例（通过工具管理器）',
  aliases: ['agents_tool'],
  argumentHint: '[list|create|delete|help] [args]',
  whenToUse:
    '当你需要管理命名 Agent 实例时，例如注册特定类型的 Agent 供后续使用',
  getPromptForCommand,
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (
        !subcommand ||
        subcommand === 'help' ||
        subcommand === '-h' ||
        subcommand === '--help'
      ) {
        return { success: true, message: buildHelpText() };
      }

      if (subcommand === 'list') {
        const useJson = parts.includes('--json');
        return handleList({ json: useJson });
      }

      if (subcommand === 'create') {
        return handleCreate(parts);
      }

      if (subcommand === 'delete') {
        return handleDelete(parts);
      }

      return {
        success: false,
        error: `未知子命令: "${subcommand}"\n\n使用 /agent-instance help 获取帮助`,
      };
    },
  }),
};

export default agentsCommand;
