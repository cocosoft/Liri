/**
 * subagent-run 命令
 *
 * 对标 CC 源码: src/commands/tools/ai/agent.ts (AgentTool)
 * 功能: 通过工具系统执行/查看/停止子代理任务
 * 与 CC 差异: 精简为仅作任务运行器，配置管理归 /subagent
 */

import type { Command } from '../../types/index.js';
import { getToolManager } from '@modules/tools/ToolManager.js';
import { AgentTool } from '@modules/tools/AgentTool/AgentTool.js';
import { getBackgroundTaskManager } from '@modules/tools/AgentTool/BackgroundTaskManager.js';
import { getSubAgentEngine } from '../../../tools/AgentTool/SubAgentEngine.js';

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
 * 显示活跃Agent列表
 */
async function handleAgentList(): Promise<{ success: boolean; message?: string; error?: string }> {
  const agentTool = getAgentTool();

  if (!agentTool) {
    return {
      success: true,
      message: 'Agent Tool not available in current context',
    };
  }

  const agents = agentTool.getActiveAgents();
  const engine = agentTool.getEngine();
  const engineAgents = engine.getActiveAgents();

  const lines: string[] = ['📋 **Agent List**\n'];

  if (agents.length === 0 && engineAgents.length === 0) {
    lines.push('  No active agents found.');
  }

  if (agents.length > 0) {
    lines.push('**Active Agents (Tool):**');
    for (const agent of agents) {
      const icon = agent.status === 'running' ? '🔄' : agent.status === 'completed' ? '✅' : '❌';
      const duration = formatDuration(Date.now() - agent.startTime);
      lines.push(`  ${icon} [${agent.id}] ${agent.name} (${agent.type}) - ${agent.status} - ${duration}`);
    }
    lines.push('');
  }

  if (engineAgents.length > 0) {
    const activeEngineAgents = Array.from(engineAgents.entries());
    if (activeEngineAgents.length > 0) {
      lines.push('**Engine Agents:**');
      for (const [id] of activeEngineAgents) {
        lines.push(`  🤖 [${id}] - running`);
      }
      lines.push('');
    }
  }

  const bgManager = getBackgroundTaskManager();
  const activeTasks = bgManager.getActiveTasks();
  const completedTasks = bgManager.getCompletedTasks();

  if (activeTasks.length > 0) {
    lines.push('**Background Tasks (active):**');
    for (const task of activeTasks) {
      const duration = task.startedAt
        ? formatDuration(Date.now() - task.startedAt)
        : 'pending';
      lines.push(`  ⏳ [${task.taskId}] ${task.agentName} (${task.agentType}) - ${duration}`);
    }
    lines.push('');
  }

  if (completedTasks.length > 0) {
    const recentTasks = completedTasks.slice(-3);
    lines.push('**Recent Background Tasks:**');
    for (const task of recentTasks) {
      const duration = task.startedAt && task.completedAt
        ? formatDuration(task.completedAt - task.startedAt)
        : 'unknown';
      const icon = task.status === 'completed' ? '✅' : '❌';
      lines.push(`  ${icon} [${task.taskId}] ${task.agentName} - ${task.status} - ${duration}`);
    }
    lines.push('');
  }

  lines.push('**Usage:**');
  lines.push('  /subagent-run run <type> <task>  -  Run a new agent task');
  lines.push('  /subagent-run list              -  List active agents');
  lines.push('  /subagent-run status <id>       -  Check agent or background task status');
  lines.push('  /subagent-run stop <id>         -  Stop a running agent');
  lines.push('  /subagent-run bg-list           -  List background tasks');

  return { success: true, message: lines.join('\n') };
}

/**
 * 检查Agent或后台任务状态
 */
async function handleAgentStatus(id: string): Promise<{ success: boolean; message?: string; error?: string }> {
  const agentTool = getAgentTool();

  if (agentTool) {
    const status = agentTool.getAgentStatus(id);
    if (status.status !== 'not_found') {
      const icon = status.status === 'running' ? '🔄' : status.status === 'completed' ? '✅' : '❌';
      const duration = status.duration ? formatDuration(status.duration) : 'unknown';
      return {
        success: true,
        message: `${icon} Agent [${id}] status: ${status.status} (${duration})`,
      };
    }
  }

  const engine = getSubAgentEngine();
  const activeAgents = engine.getActiveAgents();
  const foundEngineAgent = activeAgents.find(a => a.agentId === id);

  if (foundEngineAgent) {
    return {
      success: true,
      message: `🤖 Engine Agent [${id}] is running (${formatDuration(foundEngineAgent.elapsedMs)})`,
    };
  }

  const bgManager = getBackgroundTaskManager();
  const task = bgManager.getTask(id);

  if (task) {
    const lines: string[] = [
      `📊 **Background Task: [${id}]**\n`,
      `  Name: ${task.agentName}`,
      `  Type: ${task.agentType}`,
      `  Status: ${task.status}`,
      `  Description: ${task.description}`,
    ];

    if (task.startedAt) {
      lines.push(`  Started: ${new Date(task.startedAt).toISOString()}`);
    }
    if (task.completedAt) {
      lines.push(`  Completed: ${new Date(task.completedAt).toISOString()}`);
    }
    if (task.tokenUsage) {
      lines.push(`  Tokens: ${task.tokenUsage.totalTokens}`);
    }
    if (task.result) {
      const preview = task.result.length > 200
        ? task.result.substring(0, 200) + '...'
        : task.result;
      lines.push(`\n  Result Preview:\n  ${preview}`);
    }
    if (task.error) {
      lines.push(`\n  Error: ${task.error}`);
    }

    return { success: true, message: lines.join('\n') };
  }

  return { success: false, error: `Agent or task not found: ${id}` };
}

/**
 * 停止Agent
 */
async function handleAgentStop(id: string): Promise<{ success: boolean; message?: string; error?: string }> {
  const agentTool = getAgentTool();
  let stopped = false;

  if (agentTool) {
    stopped = agentTool.stopAgent(id);
  }

  if (!stopped) {
    const engine = getSubAgentEngine();
    stopped = engine.abort(id);
  }

  if (stopped) {
    return { success: true, message: `Agent [${id}] has been stopped` };
  }

  return { success: false, error: `Agent not found or already stopped: ${id}` };
}

/**
 * 列出后台任务
 */
async function handleBackgroundList(): Promise<{ success: boolean; message?: string; error?: string }> {
  const bgManager = getBackgroundTaskManager();

  const tasks = bgManager.getAllTasks();
  const stats = bgManager.getStats();

  const lines: string[] = ['📊 **Background Task List**\n'];

  if (tasks.length === 0) {
    lines.push('  No background tasks found.');
  } else {
    for (const task of tasks) {
      const icon = task.status === 'completed' ? '✅'
        : task.status === 'running' ? '🔄'
        : task.status === 'failed' ? '❌'
        : task.status === 'aborted' ? '⛔'
        : '⏳';
      const duration = task.startedAt && task.completedAt
        ? formatDuration(task.completedAt - task.startedAt)
        : task.startedAt
          ? formatDuration(Date.now() - task.startedAt) + ' (running)'
          : 'pending';
      lines.push(`  ${icon} [${task.taskId}] ${task.agentName} (${task.agentType}) - ${duration}`);
    }
    lines.push('');
  }

  lines.push(`**Stats:**`);
  lines.push(`  Total: ${stats.total}`);
  lines.push(`  Running: ${stats.running}`);
  lines.push(`  Completed: ${stats.completed}`);
  lines.push(`  Failed: ${stats.failed}`);

  return { success: true, message: lines.join('\n') };
}

/**
 * 运行Agent任务
 */
async function handleAgentRun(agentType: string, task: string): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const toolManager = getToolManager();
    const result = await toolManager.executeTool(
      'Agent',
      {
        description: agentType,
        prompt: task,
        subagent_type: agentType,
      },
      {}
    );

    return {
      success: true,
      message: result.output || 'Agent task completed',
    };
  } catch (error) {
    return {
      success: false,
      error: `Error running agent: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Agent命令
 */
export const agentCommand: Command = {
  type: 'action',
  name: 'subagent-run',
  description: '运行/查看/停止子代理的执行任务',
  aliases: ['agent_tool'],
  argumentHint: 'run <type> <task> | list | status <id> | stop <id> | bg-list',
  whenToUse: '当你需要运行子代理执行复杂任务，或查看/管理运行中的子代理时',
  load: async () => ({
    execute: async (args: string) => {
      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      if (!subcommand || subcommand === 'help') {
        return {
          success: true,
          message: [
            'SubAgent-Run 命令帮助',
            '═══════════════════════',
            '',
            '用法:',
            '  /subagent-run run <type> <task>      - 运行新的子代理任务',
            '  /subagent-run list                   - 列出所有活跃的子代理',
            '  /subagent-run status <id>            - 查看子代理或后台任务状态',
            '  /subagent-run stop <id>              - 停止运行中的子代理',
            '  /subagent-run bg-list                - 列出所有后台任务',
            '',
            '可用的 Agent 类型:',
            '  general          - 通用子代理，可执行大多数任务',
            '  explore          - 专门用于代码探索和项目分析',
            '  plan             - 用于制定执行计划和方案',
            '  verification     - 用于验证实现是否正确',
            '  claude-code-guide - Claude Code 使用指南',
            '  statusline-setup - 状态栏设置',
            '',
            '使用示例:',
            '  /subagent-run run general "编写一个 Python 脚本"',
            '  /subagent-run list',
            '  /subagent-run status a-myagent-a1b2c3d4',
            '  /subagent-run stop a-myagent-a1b2c3d4',
            '',
            '别名: /agent_tool',
            '',
            '━━━ 相关命令对比 ━━━',
            '',
            '  /subagent-run（当前） - 子代理任务执行器：',
            '                         运行/查看/停止子代理的执行任务',
            '',
            '  /subagent            - 子代理配置管理器：',
            '                         查看/创建/删除子代理定义（.md 配置文件）',
            '',
            '  /agent-instance      - Agent 实例管理器：',
            '                         创建/删除工具管理器中的 Agent 实例（非运行任务）',
            '',
            '使用建议：',
            '  - 日常运行子代理任务 → 使用 /subagent-run',
            '  - 管理子代理配置     → 使用 /subagent',
            '  - 管理 Agent 实例   → 使用 /agent-instance',
          ].join('\n'),
        };
      }

      switch (subcommand) {
        case 'list':
          return handleAgentList();

        case 'status':
          if (!parts[1]) {
            return { success: false, error: '用法: /subagent-run status <agent_id>' };
          }
          return handleAgentStatus(parts[1]);

        case 'stop':
          if (!parts[1]) {
            return { success: false, error: '用法: /subagent-run stop <agent_id>' };
          }
          return handleAgentStop(parts[1]);

        case 'bg-list':
          return handleBackgroundList();

        case 'run':
          if (parts.length < 3) {
            return { success: false, error: '用法: /subagent-run run <agent_type> <task>\n\n示例:\n  /subagent-run run general "编写一个简单的 Python 脚本"' };
          }
          return handleAgentRun(parts[1], parts.slice(2).join(' '));

        default:
          return {
            success: false,
            error: `未知子命令 "${subcommand}"，可用子命令: run, list, status, stop, bg-list`,
          };
      }
    },
  }),
};

export default agentCommand;
