/**
 * 默认护栏规则集
 * 对标 Hermes agent/tool_guardrails.py
 */
import type { GuardrailCondition, GuardrailAction } from './GuardrailDecision';

/**
 * 工具安全性分类
 * idempotent: 幂等工具，多次调用同一参数结果相同，可安全重试
 * mutating: 变易工具，调用产生副作用，不可自动重试
 * unknown: 未分类工具
 */
export type ToolSafety = 'idempotent' | 'mutating' | 'unknown';

/**
 * 幂等工具白名单
 * 同一参数多次调用产生相同结果，无副作用
 */
export const IDEMPOTENT_TOOLS: ReadonlySet<string> = new Set([
  'Read',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
  'ToolSearch',
  'TaskGet',
  'TaskList',
  'SyntheticOutput',
]);

/**
 * 变易工具白名单
 * 调用产生副作用，不可安全重试
 */
export const MUTATING_TOOLS: ReadonlySet<string> = new Set([
  'Write',
  'Edit',
  'Bash',
  'TaskCreate',
  'TaskUpdate',
  'TaskStop',
  'SendMessage',
  'AskUserQuestion',
  'TodoWrite',
  'Skill',
  'Agent',
  'NotebookEdit',
  'EnterPlanMode',
  'ExitPlanMode',
  'EnterWorktree',
  'ExitWorktree',
  'Workflow',
  'TaskOutput',
]);

/**
 * 分类工具安全性
 * @param toolName 工具名称
 * @returns 安全性分类
 */
export function classifyTool(toolName: string): ToolSafety {
  if (IDEMPOTENT_TOOLS.has(toolName)) return 'idempotent';
  if (MUTATING_TOOLS.has(toolName)) return 'mutating';
  return 'unknown';
}

/**
 * 检查工具是否为幂等工具
 * @param toolName 工具名称
 * @returns 是否幂等
 */
export function isIdempotent(toolName: string): boolean {
  return classifyTool(toolName) === 'idempotent';
}

/**
 * 检查工具是否为变易工具
 * @param toolName 工具名称
 * @returns 是否变易
 */
export function isMutating(toolName: string): boolean {
  return classifyTool(toolName) === 'mutating';
}

/**
 * 护栏规则
 */
export interface GuardrailRule {
  /** 规则名称 */
  name: string;
  /** 规则描述 */
  description: string;
  /** 匹配条件 */
  condition: GuardrailCondition;
  /** 匹配时的动作 */
  action: GuardrailAction;
  /** 规则优先级（数值越大越优先） */
  priority: number;
  /** 是否启用 */
  enabled: boolean;
}

/**
 * 默认护栏规则集
 */
export const DEFAULT_GUARDRAIL_RULES: GuardrailRule[] = [
  {
    name: 'block_destructive_system',
    description: '阻止系统级别的破坏性命令',
    condition: {
      toolNamePattern: '^(bash|shell|exec)$',
      paramValuePattern:
        '(rm\\s+-rf\\s+/|sudo\\s+rm|chmod\\s+777\\s+/|mkfs\\.|dd\\s+if=.*of=/dev)',
    },
    action: 'block',
    priority: 100,
    enabled: true,
  },
  {
    name: 'confirm_file_delete',
    description: '文件删除操作需要用户确认',
    condition: {
      toolNamePattern: '^(file_write|file_delete)$',
      paramKeyPattern: '(path|file_path)',
    },
    action: 'confirm',
    priority: 80,
    enabled: true,
  },
  {
    name: 'warn_network_outbound',
    description: '对外网络请求进行警告',
    condition: {
      toolNamePattern: '^(web_fetch|web_search|curl|axios)',
    },
    action: 'warn',
    priority: 60,
    enabled: true,
  },
  {
    name: 'block_env_secrets',
    description: '阻止读取环境变量文件',
    condition: {
      toolNamePattern: '^(file_read|cat|read_file)$',
      paramValuePattern: '(\\.env|credentials|secrets|tokens)',
    },
    action: 'block',
    priority: 90,
    enabled: true,
  },
  {
    name: 'confirm_git_push',
    description: 'Git push 操作需要确认',
    condition: {
      toolNamePattern: '^(bash|shell|exec)$',
      paramValuePattern: 'git\\s+push',
    },
    action: 'confirm',
    priority: 70,
    enabled: true,
  },
  {
    name: 'warn_large_write',
    description: '大量文件写入操作进行警告',
    condition: {
      toolNamePattern: '^(file_write|write_file|batch_write)$',
      paramKeyPattern: '(content|data)',
    },
    action: 'warn',
    priority: 50,
    enabled: true,
  },
  {
    name: 'block_process_kill',
    description: '阻止终止关键系统进程',
    condition: {
      toolNamePattern: '^(bash|shell|exec)$',
      paramValuePattern: '(kill\\s+-9|pkill|killall)',
    },
    action: 'block',
    priority: 95,
    enabled: true,
  },
];

/**
 * 获取按优先级排序的已启用规则
 * @param rules 规则列表
 * @returns 排序后的规则列表
 */
export function getEnabledRules(rules?: GuardrailRule[]): GuardrailRule[] {
  const source = rules || DEFAULT_GUARDRAIL_RULES;

  return source
    .filter((r) => r.enabled)
    .sort((a, b) => b.priority - a.priority);
}

/**
 * 根据名称查找规则
 * @param name 规则名称
 * @param rules 规则列表
 * @returns 规则对象
 */
export function findRule(
  name: string,
  rules?: GuardrailRule[]
): GuardrailRule | undefined {
  const source = rules || DEFAULT_GUARDRAIL_RULES;

  return source.find((r) => r.name === name);
}
