/**
 * subagent-run 命令
 *
 * 对标 CC 源码: reference/cc_code/backend/tools/AgentTool/AgentTool.tsx
 * 功能: 通过工具系统执行/查看/停止子代理任务
 * 与 CC 差异: 精简为仅作任务运行器，配置管理归 /subagent
 */

import type { Command } from '@modules/commands';
import { getToolManager } from '@modules/tools';
import { AgentTool } from '@modules/tools/AgentTool/AgentTool.js';
import { taskRegistry } from '@modules/tasks';
import {
  TaskStatus,
  type BackgroundTaskInfo,
  type BackgroundTaskStatus,
} from '@modules/tasks/types.js';
import type { BaseTask } from '@modules/tasks';
import { getSubAgentEngine } from '@modules/tools/AgentTool/SubAgentEngine.js';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('commands:tools:ai:agent');

/** 可用的 Agent 类型列表 */
const AGENT_TYPES = [
  'general',
  'explore',
  'plan',
  'verification',
  'code-guide',
  'statusline-setup',
] as const;

/** 可用子命令列表 */
const SUBCOMMANDS = ['run', 'list', 'status', 'stop', 'bg-list'] as const;

/**
 * 构建帮助文本
 */
function buildHelpText(): string {
  return [
    '用法: /subagent-run <子命令> [参数]',
    '',
    '运行/查看/停止子代理的执行任务。',
    '',
    '子命令:',
    '  run <type> <task>        运行新的子代理任务',
    '    --background           在后台运行（不阻塞终端）',
    '    --model <model>        指定模型 ID（填写已注册的模型 ID）',
    '  list                     列出所有活跃的子代理',
    '    --json                 以 JSON 格式输出',
    '  status <id>              查看子代理或后台任务状态',
    '  stop <id>                停止运行中的子代理',
    '  bg-list                  列出所有后台任务',
    '    --json                 以 JSON 格式输出',
    '',
    '可用的 Agent 类型:',
    ...AGENT_TYPES.map((t) => `  ${t}`),
    '',
    '使用示例:',
    '  /subagent-run run general "编写一个 Python 脚本"',
    '  /subagent-run run explore "分析项目结构" --background',
    '  /subagent-run run plan "制定实现计划" --model your-model-id',
    '  /subagent-run list',
    '  /subagent-run status a-myagent-a1b2c3d4',
    '  /subagent-run stop a-myagent-a1b2c3d4',
    '  /subagent-run bg-list --json',
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
    '                         创建/删除命名的 Agent 实例，查看活跃子代理',
    '',
    '使用建议：',
    '  - 日常运行子代理任务 → 使用 /subagent-run',
    '  - 管理子代理配置     → 使用 /subagent',
    '  - 管理 Agent 实例   → 使用 /agent-instance',
  ].join('\n');
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
 * 将 BaseTask 转换为 BackgroundTaskInfo
 */
function taskToBgInfo(task: BaseTask): BackgroundTaskInfo {
  const state = task.taskState;
  const statusMap: Record<string, BackgroundTaskStatus> = {
    [TaskStatus.PENDING]: 'pending',
    [TaskStatus.RUNNING]: 'running',
    [TaskStatus.COMPLETED]: 'completed',
    [TaskStatus.FAILED]: 'failed',
    [TaskStatus.KILLED]: 'aborted',
  };
  return {
    taskId: state.id,
    agentName: state.type,
    agentType: state.type,
    description: state.description,
    status: statusMap[state.status] || 'pending',
    createdAt: state.startTime,
    startedAt:
      state.status === TaskStatus.RUNNING ? state.startTime : undefined,
    completedAt: state.endTime,
    error: state.error,
    tokenUsage: {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: state.tokenCount,
    },
    durationMs: state.endTime ? state.endTime - state.startTime : undefined,
  };
}

/**
 * 获取所有后台任务信息
 */
function getAllBgTaskInfos(): BackgroundTaskInfo[] {
  return taskRegistry.getAllTasks().map(taskToBgInfo);
}

/**
 * 获取任务统计
 */
function getBgStats(tasks: BackgroundTaskInfo[]): {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  aborted: number;
} {
  let pending = 0,
    running = 0,
    completed = 0,
    failed = 0,
    aborted = 0;
  for (const t of tasks) {
    switch (t.status) {
      case 'pending':
        pending++;
        break;
      case 'running':
        running++;
        break;
      case 'completed':
        completed++;
        break;
      case 'failed':
        failed++;
        break;
      case 'aborted':
        aborted++;
        break;
    }
  }
  return { total: tasks.length, pending, running, completed, failed, aborted };
}

/**
 * 显示活跃Agent列表
 */
async function handleAgentList(
  options: { json?: boolean } = {}
): Promise<{ success: boolean; message?: string; error?: string }> {
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
  const allBgTasks = getAllBgTaskInfos();
  const activeBgTasks = allBgTasks.filter(
    (t) => t.status === 'running' || t.status === 'pending'
  );
  const completedBgTasks = allBgTasks
    .filter(
      (t) =>
        t.status === 'completed' ||
        t.status === 'failed' ||
        t.status === 'aborted'
    )
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  const stats = getBgStats(allBgTasks);

  if (options.json) {
    const data = {
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        status: a.status,
        duration: Date.now() - a.startTime,
      })),
      engineAgents: Array.from(engineAgents.keys()).map((id) => ({ id })),
      backgroundTasks: {
        active: activeBgTasks.map((t) => ({
          taskId: t.taskId,
          agentName: t.agentName,
          agentType: t.agentType,
          status: t.status,
          startedAt: t.startedAt,
        })),
        completed: completedBgTasks.slice(-3).map((t) => ({
          taskId: t.taskId,
          agentName: t.agentName,
          status: t.status,
          startedAt: t.startedAt,
          completedAt: t.completedAt,
        })),
        stats: {
          total: stats.total,
          running: stats.running,
          completed: stats.completed,
          failed: stats.failed,
        },
      },
    };
    return { success: true, message: JSON.stringify(data, null, 2) };
  }

  const lines: string[] = ['📋 **Agent List**\n'];

  if (
    agents.length === 0 &&
    engineAgents.length === 0 &&
    activeBgTasks.length === 0
  ) {
    lines.push('  没有活跃的 Agent。');
  }

  if (agents.length > 0) {
    lines.push('**Active Agents (Tool):**');
    for (const agent of agents) {
      const icon =
        agent.status === 'running'
          ? '🔄'
          : agent.status === 'completed'
            ? '✅'
            : '❌';
      const duration = formatDuration(Date.now() - agent.startTime);
      lines.push(
        `  ${icon} [${agent.id}] ${agent.name} (${agent.type}) - ${agent.status} - ${duration}`
      );
    }
    lines.push('');
  }

  if (engineAgents.length > 0) {
    lines.push('**Engine Agents:**');
    for (const agent of engineAgents) {
      lines.push(`  🤖 [${agent.agentId}] - running`);
    }
    lines.push('');
  }

  if (activeBgTasks.length > 0) {
    lines.push('**Background Tasks (active):**');
    for (const task of activeBgTasks) {
      const duration = task.startedAt
        ? formatDuration(Date.now() - task.startedAt)
        : 'pending';
      lines.push(
        `  ⏳ [${task.taskId}] ${task.agentName} (${task.agentType}) - ${duration}`
      );
    }
    lines.push('');
  }

  if (completedBgTasks.length > 0) {
    const recentTasks = completedBgTasks.slice(-3);
    lines.push('**Recent Background Tasks:**');
    for (const task of recentTasks) {
      const duration =
        task.startedAt && task.completedAt
          ? formatDuration(task.completedAt - task.startedAt)
          : 'unknown';
      const icon = task.status === 'completed' ? '✅' : '❌';
      lines.push(
        `  ${icon} [${task.taskId}] ${task.agentName} - ${task.status} - ${duration}`
      );
    }
    lines.push('');
  }

  lines.push(
    `**Stats:** total=${stats.total} running=${stats.running} completed=${stats.completed} failed=${stats.failed}`
  );

  return { success: true, message: lines.join('\n') };
}

/**
 * 检查Agent或后台任务状态
 */
async function handleAgentStatus(
  id: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  const agentTool = getAgentTool();

  if (agentTool) {
    const status = agentTool.getAgentStatus(id);
    if (status.status !== 'not_found') {
      const icon =
        status.status === 'running'
          ? '🔄'
          : status.status === 'completed'
            ? '✅'
            : '❌';
      const duration = status.duration
        ? formatDuration(status.duration)
        : 'unknown';
      return {
        success: true,
        message: `${icon} Agent [${id}] status: ${status.status} (${duration})`,
      };
    }
  }

  const engine = getSubAgentEngine();
  const activeAgents = engine.getActiveAgents();
  const foundEngineAgent = Array.isArray(activeAgents)
    ? activeAgents.find((a) => a.agentId === id)
    : undefined;

  if (foundEngineAgent) {
    return {
      success: true,
      message: `🤖 Engine Agent [${id}] is running (${formatDuration(foundEngineAgent.elapsedMs)})`,
    };
  }

  const allBgTasks = getAllBgTaskInfos();
  const task = allBgTasks.find((t) => t.taskId === id);

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
      const preview =
        task.result.length > 200
          ? task.result.substring(0, 200) + '...'
          : task.result;
      lines.push(`\n  Result Preview:\n  ${preview}`);
    }
    if (task.error) {
      lines.push(`\n  Error: ${task.error}`);
    }

    return { success: true, message: lines.join('\n') };
  }

  return {
    success: false,
    error: `Agent or task not found: ${id}\n\n可能原因：\n  1. Agent ID 拼写错误 — 使用 /subagent-run list 查看正确 ID\n  2. Agent 已自然结束（不再在列表中）\n  3. 任务已完成被清理 — 使用 bg-list 查看已完成的任务`,
  };
}

/**
 * 停止Agent
 */
async function handleAgentStop(
  id: string
): Promise<{ success: boolean; message?: string; error?: string }> {
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
    return { success: true, message: `✅ Agent [${id}] has been stopped` };
  }

  return {
    success: false,
    error: `Agent not found or already stopped: ${id}`,
  };
}

/**
 * 列出后台任务
 */
async function handleBackgroundList(
  options: { json?: boolean } = {}
): Promise<{ success: boolean; message?: string; error?: string }> {
  const tasks = getAllBgTaskInfos();
  const stats = getBgStats(tasks);

  if (options.json) {
    const data = {
      tasks: tasks.map((t) => ({
        taskId: t.taskId,
        agentName: t.agentName,
        agentType: t.agentType,
        status: t.status,
        description: t.description,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        tokenUsage: t.tokenUsage,
        error: t.error,
      })),
      stats: {
        total: stats.total,
        running: stats.running,
        completed: stats.completed,
        failed: stats.failed,
      },
    };
    return { success: true, message: JSON.stringify(data, null, 2) };
  }

  const lines: string[] = ['📊 **Background Task List**\n'];

  if (tasks.length === 0) {
    lines.push('  没有后台任务。');
  } else {
    for (const task of tasks) {
      const icon =
        task.status === 'completed'
          ? '✅'
          : task.status === 'running'
            ? '🔄'
            : task.status === 'failed'
              ? '❌'
              : task.status === 'aborted'
                ? '⛔'
                : '⏳';
      const duration =
        task.startedAt && task.completedAt
          ? formatDuration(task.completedAt - task.startedAt)
          : task.startedAt
            ? formatDuration(Date.now() - task.startedAt) + ' (running)'
            : 'pending';
      lines.push(
        `  ${icon} [${task.taskId}] ${task.agentName} (${task.agentType}) - ${duration}`
      );
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
async function handleAgentRun(
  agentType: string,
  task: string,
  options: { background?: boolean; model?: string } = {}
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const toolManager = getToolManager();
    const params: Record<string, unknown> = {
      description: agentType,
      prompt: task,
      subagent_type: agentType,
    };

    if (options.background) {
      params.run_in_background = true;
    }
    if (options.model) {
      params.model = options.model;
    }

    const result = await toolManager.executeTool('Agent', params, {});

    const output = result.output || 'Agent task completed';
    const bgNote = options.background
      ? '\n\n任务已在后台运行，使用 /subagent-run bg-list 查看状态'
      : '';

    return {
      success: true,
      message: `${output}${bgNote}`,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Error running agent: ${msg}\n\n可能原因：\n  1. Agent 类型 "${agentType}" 不存在 — 使用 /subagent-run 查看可用类型\n  2. Agent 系统未初始化\n  3. 模型调用失败`,
    };
  }
}

/**
 * 解析参数中的选项
 */
function parseRunOptions(parts: string[]): {
  agentType: string;
  task: string;
  background: boolean;
  model: string | undefined;
} {
  let background = false;
  let model: string | undefined;
  const filtered: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === '--background' || p === '--bg') {
      background = true;
    } else if (p === '--model' && i + 1 < parts.length) {
      model = parts[++i];
    } else {
      filtered.push(p);
    }
  }

  const agentType = filtered[0] || '';
  const task = filtered.slice(1).join(' ').trim();

  return { agentType, task, background, model };
}

/**
 * Agent命令
 */
export const agentCommand: Command = {
  type: 'action',
  name: 'subagent-run',
  description: '运行/查看/停止子代理的执行任务',
  aliases: ['agent_tool'],
  argumentHint:
    'run <type> <task> [--background] [--model <model>] | list [--json] | status <id> | stop <id> | bg-list [--json]',
  whenToUse: [
    '当你需要运行子代理执行复杂任务，或查看/管理运行中的子代理时',
    '子代理可以并行执行独立任务（如代码探索、计划制定、验证检查）',
    '长时间任务建议使用 --background 在后台运行',
  ].join('\n'),
  getPromptForCommand: (_args: string) =>
    Promise.resolve([
      {
        type: 'text',
        text: [
          '# subagent-run 命令使用指南',
          '',
          '## 功能说明',
          '运行/查看/停止子代理的执行任务。子代理是独立的 AI 工作进程，',
          '可以并行执行复杂任务而不阻塞当前会话。',
          '',
          '## 子命令',
          '',
          '### run <type> <task> [--background] [--model <model>]',
          '运行新的子代理任务。',
          '- type: 代理类型（general, explore, plan, verification 等）',
          '- task: 要执行的任务描述',
          '- --background: 在后台运行，立即返回控制权',
          '- --model: 指定模型 ID（填写已注册的模型 ID）',
          '',
          '示例:',
          '  /subagent-run run general "分析项目中的代码质量"',
          '  /subagent-run run explore "搜索所有 TODO 注释" --background',
          '  /subagent-run run plan "为重构制定计划" --model your-model-id',
          '',
          '### list [--json]',
          '列出所有活跃的子代理和后台任务。',
          '--json 参数输出 JSON 格式供程序化处理。',
          '',
          '### status <id>',
          '查看特定 Agent 或后台任务的详细状态。',
          '',
          '### stop <id>',
          '停止运行中的子代理。',
          '',
          '### bg-list [--json]',
          '列出所有后台任务（含统计信息）。',
          '',
          '## 使用场景',
          '- 复杂代码库分析：使用 explore 代理搜索分析',
          '- 任务规划：使用 plan 代理制定实施方案',
          '- 代码审查：使用 verification 代理验证代码质量',
          '- 多任务并行：使用 --background 同时运行多个独立任务',
        ].join('\n'),
      },
    ]),
  load: async () => ({
    execute: async (args: string) => {
      const trimmed = args.trim().toLowerCase();

      if (
        !trimmed ||
        trimmed === 'help' ||
        trimmed === '-h' ||
        trimmed === '--help'
      ) {
        return { success: true, message: buildHelpText() };
      }

      const parts = args.trim().split(/\s+/);
      const subcommand = parts[0]?.toLowerCase();

      switch (subcommand) {
        case 'list': {
          const jsonFlag = parts.includes('--json');
          return handleAgentList({ json: jsonFlag });
        }

        case 'status':
          if (!parts[1]) {
            return {
              success: false,
              error:
                '用法: /subagent-run status <agent_id>\n提示: 使用 /subagent-run list 查看所有活跃 Agent 的 ID',
            };
          }
          return handleAgentStatus(parts[1]);

        case 'stop':
          if (!parts[1]) {
            return {
              success: false,
              error:
                '用法: /subagent-run stop <agent_id>\n提示: 使用 /subagent-run list 查看可停止的 Agent',
            };
          }
          return handleAgentStop(parts[1]);

        case 'bg-list': {
          const jsonFlag = parts.includes('--json');
          return handleBackgroundList({ json: jsonFlag });
        }

        case 'run':
          if (
            parts.length < 2 ||
            (parts.length === 2 && parts[1].startsWith('--'))
          ) {
            return {
              success: false,
              error: [
                '用法: /subagent-run run <agent_type> <task> [--background] [--model <model>]',
                '',
                '示例:',
                '  /subagent-run run general "编写一个简单的 Python 脚本"',
                '  /subagent-run run explore "分析项目结构" --background',
                '  /subagent-run run plan "制定实现计划" --model your-model-id',
                '',
                '可用 Agent 类型:',
                ...AGENT_TYPES.map((t) => `  ${t}`),
              ].join('\n'),
            };
          }
          {
            const opts = parseRunOptions(parts.slice(1));
            if (!opts.task) {
              return {
                success: false,
                error: `用法: /subagent-run run ${opts.agentType} "<task>"\n任务描述不能为空，请用引号包裹任务内容。`,
              };
            }
            return handleAgentRun(opts.agentType, opts.task, {
              background: opts.background,
              model: opts.model,
            });
          }

        default:
          return {
            success: false,
            error: `未知子命令 "${subcommand}"。可用子命令: ${SUBCOMMANDS.join(', ')}\n使用 /subagent-run help 查看详细帮助。`,
          };
      }
    },
  }),
};

export default agentCommand;
