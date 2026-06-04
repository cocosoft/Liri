/**
 * 工具集分组系统
 *
 * 工具按场景分组，支持组合和继承。
 * 参考 hermes toolsets.py 的 TOOLSETS 设计。
 */

/** 工具集定义 */
export interface ToolsetDef {
  name: string;
  description: string;
  tools: string[];
  /** 引用其他工具集（继承其工具列表） */
  includes?: string[];
}

/** 预置工具集 */
const BUILTIN_TOOLSETS: ToolsetDef[] = [
  {
    name: 'research',
    description: 'Web 研究：搜索 + 提取',
    tools: ['web_search', 'web_extract'],
  },
  {
    name: 'search',
    description: '仅搜索，不提取内容',
    tools: ['web_search'],
  },
  {
    name: 'vision',
    description: '图像分析',
    tools: ['vision_analyze'],
  },
  {
    name: 'image_gen',
    description: '图像生成',
    tools: ['image_generate'],
  },
  {
    name: 'terminal',
    description: '终端命令执行 + 进程管理',
    tools: ['terminal', 'process', 'bash_exec', 'bash_output'],
  },
  {
    name: 'skills',
    description: '技能管理与查看',
    tools: ['skills_list', 'skill_view', 'skill_manage'],
  },
  {
    name: 'browser',
    description: '浏览器自动化（导航、点击、输入、截图）',
    tools: [
      'browser_navigate', 'browser_snapshot', 'browser_click',
      'browser_type', 'browser_scroll', 'browser_back',
      'browser_press', 'browser_vision', 'web_search',
    ],
  },
  {
    name: 'file',
    description: '文件操作：读、写、编辑、搜索',
    tools: ['read_file', 'write_file', 'edit', 'search_files', 'glob', 'grep'],
    includes: ['research'], // 文件操作通常需要搜索
  },
  {
    name: 'code',
    description: '代码执行 + LSP',
    tools: ['execute_code', 'lsp_diagnostics', 'lsp_completion'],
  },
  {
    name: 'tts',
    description: '文本转语音',
    tools: ['text_to_speech'],
  },
  {
    name: 'todo',
    description: '任务规划与追踪',
    tools: ['todo'],
  },
  {
    name: 'memory',
    description: '跨会话持久化记忆',
    tools: ['memory'],
  },
  {
    name: 'session_search',
    description: '搜索历史会话',
    tools: ['session_search'],
  },
  {
    name: 'cronjob',
    description: '定时任务管理',
    tools: ['cronjob'],
  },
  {
    name: 'messaging',
    description: '跨平台消息发送',
    tools: ['send_message'],
  },
  {
    name: 'kanban',
    description: '看板任务管理',
    tools: ['kanban_show', 'kanban_create', 'kanban_complete'],
  },
  {
    name: 'mcp',
    description: 'MCP 工具代理',
    tools: ['mcp_call'],
  },
  {
    name: 'full',
    description: '全部工具（不含高频成本工具）',
    tools: [],
    includes: [
      'research', 'vision', 'terminal', 'skills', 'browser',
      'file', 'code', 'todo', 'memory', 'session_search', 'mcp',
    ],
  },
];

const toolsetIndex: Map<string, ToolsetDef> = new Map(
  BUILTIN_TOOLSETS.map((t) => [t.name, t]),
);

/**
 * 递归解析工具集，展开 includes 引用。
 * 使用 visited 防死循环。
 */
function resolveToolsetNames(
  name: string,
  visited: Set<string> = new Set(),
): string[] {
  if (visited.has(name)) return [];
  visited.add(name);

  const ts = toolsetIndex.get(name);
  if (!ts) return [];

  const tools = [...ts.tools];

  if (ts.includes) {
    for (const includedName of ts.includes) {
      tools.push(...resolveToolsetNames(includedName, visited));
    }
  }

  return [...new Set(tools)];
}

/**
 * 根据工具集名称列表获取展开后的工具名列表。
 */
export function resolveToolsets(names: string[]): string[] {
  const result: string[] = [];
  for (const name of names) {
    result.push(...resolveToolsetNames(name));
  }
  return [...new Set(result)];
}

/**
 * 从启用/禁用工具集计算最终工具列表。
 * @param enabled 启用的工具集名列表
 * @param disabled 禁用的工具集名列表
 */
export function computeToolNames(
  enabled: string[],
  disabled: string[] = [],
): string[] {
  const enabledTools = resolveToolsets(enabled);
  const disabledTools = new Set(resolveToolsets(disabled));
  return enabledTools.filter((t) => !disabledTools.has(t));
}

/** 获取所有预置工具集定义 */
export function listAvailableToolsets(): ToolsetDef[] {
  return BUILTIN_TOOLSETS;
}

/** 获取单个工具集定义 */
export function getToolsetInfo(name: string): ToolsetDef | undefined {
  return toolsetIndex.get(name);
}

/** 注册自定义工具集 */
export function registerCustomToolset(ts: ToolsetDef): void {
  toolsetIndex.set(ts.name, ts);
}
