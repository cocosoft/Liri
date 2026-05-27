/**
 * 工具目录与 Profile 定义
 * 按 profile 对工具进行分类，定义每个 profile 下的可用工具范围
 */

import type { Tool } from '../types/Tool';
import type { ToolProfile } from './ToolPolicy';

/**
 * 工具分类标签
 */
export const ToolCategory = {
  /** 文件读取 */
  FILE_READ: 'file_read',
  /** 文件写入 */
  FILE_WRITE: 'file_write',
  /** 文件编辑 */
  FILE_EDIT: 'file_edit',
  /** 文件转换 */
  FILE_CONVERT: 'file_convert',
  /** 搜索 */
  SEARCH: 'search',
  /** 终端执行 */
  SHELL: 'shell',
  /** 代码分析 */
  CODE_ANALYSIS: 'code_analysis',
  /** LSP */
  LSP: 'lsp',
  /** 网页 */
  WEB: 'web',
  /** 消息 */
  MESSAGING: 'messaging',
  /** 任务 */
  TASK: 'task',
  /** 计划 */
  PLAN: 'plan',
  /** 代理 */
  AGENT: 'agent',
  /** 技能 */
  SKILL: 'skill',
  /** 系统管理 */
  ADMIN: 'admin',
  /** 配置 */
  CONFIG: 'config',
  /** 工具搜索 */
  TOOL_SEARCH: 'tool_search',
  /** 团队 */
  TEAM: 'team',
  /** 监控 */
  MONITOR: 'monitor',
  /** 时间 */
  TIME: 'time',
  /** 清单 */
  TODO: 'todo',
  /** 其他 */
  OTHER: 'other',
} as const;

export type ToolCategory = (typeof ToolCategory)[keyof typeof ToolCategory];

/**
 * 工具到分类的映射规则
 * 使用工具名称匹配规则将工具分配到分类
 */
export interface CatalogRule {
  /** 分类 */
  category: ToolCategory;
  /** 匹配模式（工具名称 glob） */
  patterns: string[];
}

/**
 * 默认工具分类映射规则
 */
export const DEFAULT_CATALOG_RULES: CatalogRule[] = [
  {
    category: ToolCategory.FILE_READ,
    patterns: ['read', 'file_read', 'FileRead'],
  },
  {
    category: ToolCategory.FILE_WRITE,
    patterns: ['write', 'file_write', 'FileWrite'],
  },
  {
    category: ToolCategory.FILE_EDIT,
    patterns: ['edit', 'file_edit', 'FileEdit'],
  },
  {
    category: ToolCategory.FILE_CONVERT,
    patterns: ['convert', 'file_convert', 'FileConvert'],
  },
  {
    category: ToolCategory.SEARCH,
    patterns: ['grep', 'glob', 'search', 'Grep', 'Glob', 'ToolSearch'],
  },
  {
    category: ToolCategory.SHELL,
    patterns: ['bash', 'shell', 'powershell', 'PowerShell', 'Bash'],
  },
  {
    category: ToolCategory.CODE_ANALYSIS,
    patterns: ['code_analysis', 'CodeAnalysis'],
  },
  { category: ToolCategory.LSP, patterns: ['lsp', 'LSP'] },
  {
    category: ToolCategory.WEB,
    patterns: [
      'web_fetch',
      'web_search',
      'WebFetch',
      'WebSearch',
      'browser',
      'Browser',
    ],
  },
  {
    category: ToolCategory.MESSAGING,
    patterns: ['send_message', 'SendMessage', 'ask_user', 'AskUserQuestion'],
  },
  {
    category: ToolCategory.TASK,
    patterns: ['task_', 'Task', 'todo', 'TodoWrite'],
  },
  {
    category: ToolCategory.PLAN,
    patterns: [
      'plan',
      'Plan',
      'enter_plan',
      'exit_plan',
      'EnterPlanMode',
      'ExitPlanMode',
    ],
  },
  { category: ToolCategory.AGENT, patterns: ['agent', 'Agent'] },
  { category: ToolCategory.SKILL, patterns: ['skill', 'Skill'] },
  {
    category: ToolCategory.ADMIN,
    patterns: ['config', 'Config', 'monitor', 'Monitor'],
  },
  { category: ToolCategory.CONFIG, patterns: ['config'] },
  { category: ToolCategory.TEAM, patterns: ['team', 'Team'] },
  { category: ToolCategory.TIME, patterns: ['time', 'Time', 'sleep', 'Sleep'] },
  { category: ToolCategory.TODO, patterns: ['todo'] },
  {
    category: ToolCategory.TOOL_SEARCH,
    patterns: ['tool_search', 'ToolSearch'],
  },
];

/**
 * Profile 定义
 * 每个 profile 包含允许的工具分类列表
 */
export interface ProfileDefinition {
  /** profile 名称 */
  name: ToolProfile;
  /** 描述 */
  description: string;
  /** 允许的工具分类 */
  allowedCategories: ToolCategory[];
  /** 明确的允许工具名称列表（优先级高于分类规则） */
  allowedToolNames?: string[];
  /** 明确的拒绝工具名称列表（优先级最高） */
  deniedToolNames?: string[];
}

/**
 * coding profile: 开发场景，暴露全量工具
 */
const CODING_PROFILE: ProfileDefinition = {
  name: 'coding',
  description: '开发场景，暴露文件读写、搜索、终端等全量工具',
  allowedCategories: Object.values(ToolCategory),
};

/**
 * messaging profile: 消息/沟通场景，仅暴露消息发送、信息查询类工具
 */
const MESSAGING_PROFILE: ProfileDefinition = {
  name: 'messaging',
  description: '消息/沟通场景，仅暴露消息发送、信息查询类工具',
  allowedCategories: [
    ToolCategory.FILE_READ,
    ToolCategory.SEARCH,
    ToolCategory.WEB,
    ToolCategory.MESSAGING,
    ToolCategory.TIME,
    ToolCategory.TOOL_SEARCH,
  ],
  deniedToolNames: [
    'bash',
    'Bash',
    'PowerShell',
    'powershell',
    'write',
    'FileWrite',
    'edit',
    'FileEdit',
  ],
};

/**
 * minimal profile: 最小化场景，仅暴露最基础的只读工具
 */
const MINIMAL_PROFILE: ProfileDefinition = {
  name: 'minimal',
  description: '最小化场景，仅暴露最基础的只读工具',
  allowedCategories: [
    ToolCategory.FILE_READ,
    ToolCategory.SEARCH,
    ToolCategory.TIME,
    ToolCategory.TOOL_SEARCH,
  ],
  deniedToolNames: [
    'bash',
    'Bash',
    'PowerShell',
    'powershell',
    'write',
    'FileWrite',
    'edit',
    'FileEdit',
    'web_fetch',
    'WebFetch',
    'web_search',
    'WebSearch',
    'browser',
    'Browser',
    'send_message',
    'SendMessage',
    'ask_user',
    'AskUserQuestion',
  ],
};

/**
 * 所有 profile 定义
 */
export const PROFILE_DEFINITIONS: Record<ToolProfile, ProfileDefinition> = {
  coding: CODING_PROFILE,
  messaging: MESSAGING_PROFILE,
  minimal: MINIMAL_PROFILE,
};

/**
 * 工具分类器
 * 将工具按名称映射到分类
 */
export class ToolClassifier {
  private rules: CatalogRule[];

  constructor(rules: CatalogRule[] = DEFAULT_CATALOG_RULES) {
    this.rules = rules;
  }

  /**
   * 将工具分配到分类
   */
  classify(tool: Tool): ToolCategory {
    const name = tool.name;
    for (const rule of this.rules) {
      for (const pattern of rule.patterns) {
        if (this.matchPattern(name, pattern)) {
          return rule.category;
        }
      }
    }
    return ToolCategory.OTHER;
  }

  /**
   * 批量分类
   */
  classifyBatch(tools: Tool[]): Map<string, ToolCategory> {
    const result = new Map<string, ToolCategory>();
    for (const tool of tools) {
      result.set(tool.name, this.classify(tool));
    }
    return result;
  }

  /**
   * 简单通配符匹配（支持前缀匹配，如 task_ 匹配 task_create）
   */
  private matchPattern(name: string, pattern: string): boolean {
    if (pattern.endsWith('_')) {
      return name.startsWith(pattern);
    }
    return name.toLowerCase() === pattern.toLowerCase();
  }
}

/**
 * 根据 profile 获取允许的工具列表
 * @param tools 所有可用工具
 * @param profile 目标 profile
 * @param classifier 可选的分类器（默认使用新实例）
 * @returns 过滤后的工具列表
 */
export function filterToolsByProfile(
  tools: Tool[],
  profile: ToolProfile,
  classifier: ToolClassifier = new ToolClassifier()
): Tool[] {
  const profileDef = PROFILE_DEFINITIONS[profile];
  if (!profileDef) {
    return tools;
  }

  return tools.filter((tool) => {
    const name = tool.name;

    if (
      profileDef.deniedToolNames?.some(
        (n) => n.toLowerCase() === name.toLowerCase()
      )
    ) {
      return false;
    }

    if (
      profileDef.allowedToolNames?.some(
        (n) => n.toLowerCase() === name.toLowerCase()
      )
    ) {
      return true;
    }

    const category = classifier.classify(tool);
    return profileDef.allowedCategories.includes(category);
  });
}
