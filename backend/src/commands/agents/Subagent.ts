/**
 * Subagent 命令实现
 * 管理多个 Agent 定义，支持从不同源加载 .md 配置文件
 */
import { readdir, readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { CommandContext, CommandResult } from '@modules/commands/types';

/**
 * Agent 源类型
 */
type AgentSource = 'built-in' | 'plugin' | 'userSettings' | 'projectSettings' | 'policySettings' | 'flagSettings' | 'localSettings';

/**
 * Agent 源分组
 */
const AGENT_SOURCE_GROUPS: { label: string; source: AgentSource }[] = [
  { label: '内置 Agent', source: 'built-in' },
  { label: '插件 Agent', source: 'plugin' },
  { label: '用户 Agent', source: 'userSettings' },
  { label: '项目 Agent', source: 'projectSettings' },
  { label: '本地 Agent', source: 'localSettings' },
  { label: '管理 Agent', source: 'policySettings' },
  { label: '标志 Agent', source: 'flagSettings' },
];

/**
 * 源显示名称映射
 */
const SOURCE_LABELS: Record<AgentSource, string> = {
  'built-in': '内置',
  plugin: '插件',
  userSettings: '用户',
  projectSettings: '项目',
  localSettings: '本地',
  policySettings: '管理',
  flagSettings: '标志',
};

/**
 * Agent 优先级（数字越小优先级越高）
 */
const SOURCE_PRIORITY: Record<AgentSource, number> = {
  'built-in': 7,
  plugin: 6,
  userSettings: 1,
  projectSettings: 2,
  localSettings: 3,
  policySettings: 4,
  flagSettings: 5,
};

/**
 * 内置 Agent 定义
 */
interface AgentInfo {
  agentType: string;
  whenToUse: string;
  source: AgentSource;
  tools?: string[];
  model?: string;
  memory?: string;
  color?: string;
  filename?: string;
  baseDir?: string;
  isBuiltIn: boolean;
}

/**
 * 内置 Agent 列表
 */
const BUILT_IN_AGENTS: AgentInfo[] = [
  {
    agentType: 'general-purpose',
    whenToUse: '通用编码和调试助手，适合处理日常开发任务',
    source: 'built-in',
    tools: ['*'],
    isBuiltIn: true,
  },
  {
    agentType: 'explore',
    whenToUse: '探索代码库结构，理解现有代码，查找关键组件',
    source: 'built-in',
    isBuiltIn: true,
  },
  {
    agentType: 'plan',
    whenToUse: '规划复杂的编码任务和功能，拆解为可管理步骤',
    source: 'built-in',
    isBuiltIn: true,
  },
  {
    agentType: 'claude-code-guide',
    whenToUse: '代码审查、最佳实践指导、代码质量改进',
    source: 'built-in',
    isBuiltIn: true,
  },
  {
    agentType: 'verification',
    whenToUse: '验证实现是否正确，运行构建/测试/Linter 检查',
    source: 'built-in',
    isBuiltIn: true,
  },
  {
    agentType: 'statusline-setup',
    whenToUse: '设置状态栏，将 Shell PS1 配置转换为 statusLine 命令',
    source: 'built-in',
    isBuiltIn: true,
  },
];

/**
 * 解析标志参数
 */
function parseFlags(args: string): { showJson: boolean; subcommand: string; rest: string[] } {
  const trimmed = args.trim();
  const showJson = /(^|\s)--json(\s|$)/.test(trimmed);
  const cleaned = trimmed.replace(/--json\s*/g, '').trim();
  const parts = cleaned.split(/\s+/);
  const subcommand = parts[0]?.toLowerCase() || '';
  const rest = parts.slice(1).filter(p => p.length > 0);

  return { showJson, subcommand, rest };
}

/**
 * 显示帮助信息
 */
function showHelp(): CommandResult {
  const message = [
    'SubAgent 命令用法',
    '═══════════════════',
    '',
    '  /subagent                        - 列出所有活跃 Agent（默认）',
    '  /subagent list                   - 列出所有活跃 Agent（按来源分组）',
    '  /subagent info <名称>             - 查看 Agent 详情',
    '  /subagent create <名称> <描述>     - 创建新 Agent（可加 --tools 指定工具）',
    '  /subagent delete <名称>           - 删除 Agent',
    '  /subagent --json                 - 以 JSON 格式输出 Agent 列表',
    '  /subagent help                   - 显示此帮助',
    '',
    '别名: /agent, /agents',
    '',
    '示例:',
    '  /subagent list',
    '  /subagent info general-purpose',
    '  /subagent create my-agent "我的自定义助手"',
    '  /subagent create code-reviewer "代码审查助手" --tools "file_read,file_write,grep"',
    '  /subagent delete my-agent',
    '  /subagent list --json',
    '',
    '━━━ 相关命令对比 ━━━',
    '',
    '  /subagent（当前）  - 子代理配置管理器：',
    '                      查看/创建/删除子代理定义（.md 配置文件）',
    '',
    '  /subagent-run    - 子代理任务执行器：',
    '                      运行/查看/停止子代理的执行任务',
    '',
    '  /agent-instance  - Agent 实例管理器：',
    '                      创建/删除命名的 Agent 实例，查看活跃子代理',
    '',
    '使用建议：',
    '  - 日常运行子代理任务 → 使用 /subagent-run',
    '  - 管理子代理配置     → 使用 /subagent',
    '  - 管理 Agent 实例   → 使用 /agent-instance',
  ].join('\n');

  return { success: true, message };
}

/**
 * 获取 Agent 配置文件目录
 */
function getAgentsDirs(): { source: AgentSource; dir: string }[] {
  const home = homedir();
  const cwd = process.cwd();

  return [
    { source: 'userSettings', dir: join(home, '.claude', 'agents') },
    { source: 'projectSettings', dir: join(cwd, '.claude', 'agents') },
  ];
}

/**
 * 解析 Markdown Agent 文件
 */
async function parseAgentMarkdown(filePath: string, source: AgentSource): Promise<AgentInfo | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const fileName = basename(filePath, '.md');

    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) return null;

    const frontmatterStr = frontmatterMatch[1];
    const body = frontmatterMatch[2].trim();

    const frontmatter: Record<string, string> = {};
    for (const line of frontmatterStr.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '');
        frontmatter[key] = value;
      }
    }

    const agentType = frontmatter['name'] || fileName;
    const whenToUse = frontmatter['description'] || body.slice(0, 100);

    if (!whenToUse) return null;

    return {
      agentType,
      whenToUse: whenToUse.replace(/\\n/g, '\n'),
      source,
      tools: frontmatter['tools'] ? frontmatter['tools'].split(',').map(t => t.trim()) : undefined,
      model: frontmatter['model'],
      memory: frontmatter['memory'],
      color: frontmatter['color'],
      filename: basename(filePath),
      baseDir: filePath,
      isBuiltIn: false,
    };
  } catch {
    return null;
  }
}

/**
 * 加载所有 Agent
 */
async function loadAllAgents(): Promise<AgentInfo[]> {
  const agents: AgentInfo[] = [...BUILT_IN_AGENTS];

  for (const { source, dir } of getAgentsDirs()) {
    try {
      if (!existsSync(dir)) continue;
      const files = await readdir(dir);
      const mdFiles = files.filter(f => f.endsWith('.md'));

      for (const file of mdFiles) {
        const agent = await parseAgentMarkdown(join(dir, file), source);
        if (agent) agents.push(agent);
      }
    } catch {
      // 跳过不可读目录
    }
  }

  return agents;
}

/**
 * 获取活跃 Agent（按优先级去重）
 */
function getActiveAgents(allAgents: AgentInfo[]): AgentInfo[] {
  const agentMap = new Map<string, AgentInfo>();

  const sorted = [...allAgents].sort(
    (a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source]
  );

  for (const agent of sorted) {
    agentMap.set(agent.agentType, agent);
  }

  return Array.from(agentMap.values());
}

/**
 * 按源分组 Agent
 */
function groupAgentsBySource(agents: AgentInfo[]): Map<AgentSource, AgentInfo[]> {
  const groups = new Map<AgentSource, AgentInfo[]>();

  for (const group of AGENT_SOURCE_GROUPS) {
    groups.set(group.source, []);
  }

  for (const agent of agents) {
    const list = groups.get(agent.source);
    if (list) {
      list.push(agent);
    }
  }

  return groups;
}

/**
 * 格式化 Agent 列表显示
 */
function formatAgentList(agents: AgentInfo[]): string[] {
  const activeAgents = getActiveAgents(agents);
  const groups = groupAgentsBySource(activeAgents);
  const lines: string[] = ['Agent 列表', '═══════════', ''];

  let totalActive = 0;

  for (const { label, source } of AGENT_SOURCE_GROUPS) {
    const groupAgents = groups.get(source) || [];

    if (groupAgents.length === 0) continue;

    lines.push(`  ${label}:`);
    for (const agent of groupAgents) {
      const modelInfo = agent.model ? ` · ${agent.model}` : '';
      const memoryInfo = agent.memory ? ` · ${agent.memory} memory` : '';
      const sourceInfo = agent.isBuiltIn ? '' : ` (${SOURCE_LABELS[source]})`;
      lines.push(`    ${agent.agentType}${modelInfo}${memoryInfo}${sourceInfo}`);
      totalActive++;
    }
    lines.push('');
  }

  if (totalActive === 0) {
    lines.push('  暂无可用 Agent');
    lines.push('');
  } else {
    lines.unshift(`共 ${totalActive} 个活跃 Agent`);
    lines.unshift('');
  }

  lines.push('使用 /subagent info <名称> 查看详情');
  lines.push('使用 /subagent create <名称> <描述> 创建新 Agent');

  return lines;
}

/**
 * 格式化 Agent 详情
 */
function formatAgentDetail(agent: AgentInfo): string[] {
  const sourceName = SOURCE_LABELS[agent.source] || agent.source;
  const lines: string[] = [
    `Agent 详情: ${agent.agentType}`,
    '═══════════════════',
    '',
    `  名称: ${agent.agentType}`,
    `  来源: ${sourceName}${agent.isBuiltIn ? '（内置）' : ''}`,
    `  描述: ${agent.whenToUse}`,
  ];

  if (agent.tools) {
    lines.push(`  工具: ${agent.tools.join(', ')}`);
  }

  if (agent.model) {
    lines.push(`  模型: ${agent.model}`);
  }

  if (agent.memory) {
    lines.push(`  记忆: ${agent.memory}`);
  }

  if (agent.filename) {
    lines.push(`  文件: ${agent.filename}`);
  }

  if (agent.baseDir && !agent.isBuiltIn) {
    lines.push(`  路径: ${agent.baseDir}`);
  }

  return lines;
}

/**
 * 构建 Agent JSON 对象（序列化安全）
 */
function agentToJson(agent: AgentInfo): Record<string, unknown> {
  return {
    agentType: agent.agentType,
    whenToUse: agent.whenToUse,
    source: agent.source,
    sourceLabel: SOURCE_LABELS[agent.source] || agent.source,
    isBuiltIn: agent.isBuiltIn,
    tools: agent.tools || null,
    model: agent.model || null,
    memory: agent.memory || null,
    filename: agent.filename || null,
    path: agent.isBuiltIn ? null : (agent.baseDir || null),
  };
}

/**
 * 创建 Agent 文件
 */
async function createAgentFile(agentType: string, description: string, tools?: string): Promise<string> {
  const cwd = process.cwd();
  const agentsDir = join(cwd, '.claude', 'agents');

  if (!existsSync(agentsDir)) {
    await mkdir(agentsDir, { recursive: true });
  }

  const fileName = `${agentType}.md`;
  const filePath = join(agentsDir, fileName);

  if (existsSync(filePath)) {
    throw new Error(`Agent '${agentType}' 已存在`);
  }

  const toolsList = tools
    ? tools.split(',').map(t => t.trim()).join(', ')
    : '';

  const content = `---
name: ${agentType}
description: ${description}
${toolsList ? `tools: ${toolsList}` : ''}
---

${description}

请在此处填写 Agent 的系统提示词（System Prompt），定义 Agent 的行为和职责范围。
`;

  await writeFile(filePath, content, 'utf-8');

  return filePath;
}

/**
 * 删除 Agent 文件
 */
async function deleteAgentFile(agentType: string): Promise<string> {
  const dirs = getAgentsDirs();

  for (const { dir } of dirs) {
    const filePath = join(dir, `${agentType}.md`);
    if (existsSync(filePath)) {
      await unlink(filePath);
      return filePath;
    }
  }

  const isBuiltIn = BUILT_IN_AGENTS.some(a => a.agentType === agentType);
  if (isBuiltIn) {
    throw new Error(`'${agentType}' 是内置 Agent，无法删除`);
  }

  throw new Error(`Agent '${agentType}' 不存在`);
}

/**
 * 从参数中提取 tools 标志
 */
function extractTools(parts: string[]): { description: string; tools: string | undefined } {
  const toolFlagIdx = parts.indexOf('--tools');
  const tools = toolFlagIdx > 0 ? parts.slice(toolFlagIdx + 1).join(' ') : undefined;
  const descEndIdx = toolFlagIdx > 0 ? toolFlagIdx : parts.length;
  const description = parts.slice(0, descEndIdx).join(' ');

  return { description, tools };
}

/**
 * 处理 list 子命令
 */
async function handleList(showJson: boolean): Promise<CommandResult> {
  const allAgents = await loadAllAgents();

  if (showJson) {
    const activeAgents = getActiveAgents(allAgents);
    return { success: true, message: JSON.stringify(activeAgents.map(agentToJson), null, 2) };
  }

  return { success: true, message: formatAgentList(allAgents).join('\n') };
}

/**
 * 处理 info 子命令
 */
async function handleInfo(agentName: string, showJson: boolean): Promise<CommandResult> {
  if (!agentName) {
    return { success: false, message: '请指定 Agent 名称\n用法: /subagent info <名称>' };
  }

  const allAgents = await loadAllAgents();
  const agent = allAgents.find(a => a.agentType === agentName);

  if (!agent) {
    const suggestions = allAgents
      .filter(a => a.agentType.includes(agentName))
      .map(a => `  - ${a.agentType}`);

    const hint = suggestions.length > 0
      ? `\n\n您是不是想查找：\n${suggestions.join('\n')}`
      : '';

    return { success: false, message: `Agent '${agentName}' 不存在${hint}` };
  }

  if (showJson) {
    return { success: true, message: JSON.stringify(agentToJson(agent), null, 2) };
  }

  return { success: true, message: formatAgentDetail(agent).join('\n') };
}

/**
 * 处理 create 子命令
 */
async function handleCreate(parts: string[]): Promise<CommandResult> {
  const agentType = parts[0];

  if (!agentType || parts.length < 1) {
    return { success: false, message: '请指定 Agent 名称和描述\n用法: /subagent create <名称> <描述>' };
  }

  const { description, tools } = extractTools(parts.slice(1));

  if (!description) {
    return { success: false, message: '请指定 Agent 名称和描述\n用法: /subagent create <名称> <描述>' };
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(agentType)) {
    return { success: false, message: 'Agent 名称只能包含字母、数字、下划线和连字符' };
  }

  const filePath = await createAgentFile(agentType, description, tools);

  return {
    success: true,
    message: [
      `Agent '${agentType}' 创建成功`,
      '═══════════════════',
      '',
      `  路径: ${filePath}`,
      '',
      '编辑该文件完善系统提示词（System Prompt），',
      '然后重启应用即可使用。',
      '',
      `命令: /subagent create ${agentType} "..."`
    ].join('\n'),
  };
}

/**
 * 处理 delete 子命令
 */
async function handleDelete(agentName: string): Promise<CommandResult> {
  if (!agentName) {
    return { success: false, message: '请指定 Agent 名称\n用法: /subagent delete <名称>' };
  }

  const filePath = await deleteAgentFile(agentName);

  return {
    success: true,
    message: `Agent '${agentName}' 已删除\n  路径: ${filePath}`,
  };
}

/**
 * subagent 命令
 */
const subagentCommand = {
  async execute(args: string, context: CommandContext): Promise<CommandResult> {
    try {
      const { showJson, subcommand, rest } = parseFlags(args);

      if (!subcommand || subcommand === 'help') {
        return showHelp();
      }

      if (subcommand === 'list' || (subcommand === '' && !showJson)) {
        return await handleList(showJson);
      }

      if (subcommand === 'info') {
        return await handleInfo(rest[0] || '', showJson);
      }

      if (subcommand === 'create') {
        return await handleCreate(rest);
      }

      if (subcommand === 'delete') {
        return await handleDelete(rest[0] || '');
      }

      if (showJson && subcommand === '') {
        return await handleList(true);
      }

      try {
        const { logEvent } = await import('@modules/analytics/index.js');
        logEvent('tengu_subagent_view', { subcommand, showJson });
      } catch {
        // analytics 非关键
      }

      return { success: false, message: `未知子命令: ${subcommand}\n\n使用 /subagent help 查看帮助` };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

export default subagentCommand;
