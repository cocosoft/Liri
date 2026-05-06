/**
 * agent-instance 命令
 *
 * 对标 CC 源码: src/commands/tools/ai/agents.ts (Agent 实例管理)
 * 功能: 创建/删除工具管理器中的 Agent 实例
 * 与 CC 差异: 仅保留实例管理功能，任务执行归 /subagent-run
 */

import type { Command } from '@modules/commands/types';
import { getToolManager } from '@modules/tools/ToolManager.js';

/**
 * Agents命令
 */
export const agentsCommand: Command = {
  type: 'action',
  name: 'agent-instance',
  description: '管理多个Agent实例（通过工具管理器）',
  aliases: ['agents_tool'],
  argumentHint: '[list|create|delete|help] [args]',
  whenToUse: '当你需要通过工具管理器管理多个Agent实例时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (!subcommand || subcommand === 'help') {
        return {
          success: true,
          message: [
            'Agent-Instance 命令帮助',
            '═══════════════════════',
            '',
            '用法:',
            '  /agent-instance list                    - 列出所有活跃的 Agent',
            '  /agent-instance create <type> <name>    - 创建新的 Agent',
            '  /agent-instance delete <agent_id>       - 删除指定 Agent',
            '',
            '使用示例:',
            '  /agent-instance list',
            '  /agent-instance create general my_agent',
            '  /agent-instance delete 12345',
            '',
            '别名: /agents_tool',
            '',
            '━━━ 相关命令对比 ━━━',
            '',
            '  /agent-instance（当前） - Agent 实例管理器：',
            '                           创建/删除工具管理器中的 Agent 实例（非运行任务）',
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
          ].join('\n'),
        };
      }

      if (subcommand === 'list') {
        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool(
            'Agent',
            {
              action: 'list',
            },
            {}
          );

          if (result.agents && result.agents.length > 0) {
            return {
              success: true,
              message: `Active Agents:\n${result.agents.map((agent: any) => `  ${agent.id}: ${agent.name} (${agent.type})`).join('\n')}`,
            };
          } else {
            return {
              success: true,
              message: 'No active agents',
            };
          }
        } catch (error) {
          return {
            success: false,
            error: `列出 Agent 时出错: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      if (subcommand === 'create') {
        const agentType = parts[1];
        const agentName = parts[2];

        if (!agentType || !agentName) {
          return {
            success: false,
            error:
              '请指定 Agent 类型和名称\n用法: /agent-instance create <type> <name>',
          };
        }

        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool(
            'Agent',
            {
              action: 'create',
              agent_type: agentType,
              name: agentName,
            },
            {}
          );

          return {
            success: true,
            message: `Agent created: ${result.agent_id}`,
          };
        } catch (error) {
          return {
            success: false,
            error: `创建 Agent 时出错: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      if (subcommand === 'delete') {
        const agentId = parts[1];

        if (!agentId) {
          return {
            success: false,
            error:
              '请指定 Agent ID\n用法: /agent-instance delete <agent_id>',
          };
        }

        try {
          const toolManager = getToolManager();
          const result = await toolManager.executeTool(
            'Agent',
            {
              action: 'delete',
              agent_id: agentId,
            },
            {}
          );

          return {
            success: true,
            message: `Agent deleted: ${agentId}`,
          };
        } catch (error) {
          return {
            success: false,
            error: `删除 Agent 时出错: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }

      return {
        success: false,
        error: `未知子命令: ${subcommand}\n\n使用 /agent-instance help 获取帮助`,
      };
    },
  }),
};

export default agentsCommand;
