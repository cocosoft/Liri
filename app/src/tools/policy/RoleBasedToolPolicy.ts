/**
 * 基于角色的工具策略
 * 按 owner/operator/guest 角色过滤可用的工具
 * owner: 全部工具可用
 * operator: 不允许系统管理类工具（config、monitor、team 管理等）
 * guest: 仅允许只读工具（file_read、search、time 等）
 */

import type { Tool } from '../types/Tool';
import type {
  ToolPolicy,
  PolicyContext,
  PolicyResult,
  PolicyUserRole,
} from './ToolPolicy';
import { allowResult, denyResult } from './ToolPolicy';
import { ToolClassifier, ToolCategory } from './ToolCatalog';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:rolePolicy');

/**
 * 按角色授权的分类白名单
 */
const ROLE_ALLOWED_CATEGORIES: Record<PolicyUserRole, Set<ToolCategory>> = {
  owner: new Set(Object.values(ToolCategory)),
  operator: new Set([
    ToolCategory.FILE_READ,
    ToolCategory.FILE_WRITE,
    ToolCategory.FILE_EDIT,
    ToolCategory.FILE_CONVERT,
    ToolCategory.SEARCH,
    ToolCategory.SHELL,
    ToolCategory.CODE_ANALYSIS,
    ToolCategory.LSP,
    ToolCategory.WEB,
    ToolCategory.MESSAGING,
    ToolCategory.TASK,
    ToolCategory.PLAN,
    ToolCategory.AGENT,
    ToolCategory.SKILL,
    ToolCategory.TIME,
    ToolCategory.TODO,
    ToolCategory.TOOL_SEARCH,
    ToolCategory.OTHER,
  ]),
  guest: new Set([
    ToolCategory.FILE_READ,
    ToolCategory.SEARCH,
    ToolCategory.TIME,
    ToolCategory.TOOL_SEARCH,
  ]),
};

/**
 * 按角色拒绝的特定工具名称
 */
const ROLE_DENIED_TOOLS: Record<PolicyUserRole, string[]> = {
  owner: [],
  operator: [
    'config',
    'Config',
    'ConfigTool',
    'monitor',
    'Monitor',
    'MonitorTool',
    'team_create',
    'TeamCreate',
    'team_delete',
    'TeamDelete',
  ],
  guest: [
    'bash',
    'Bash',
    'BashTool',
    'PowerShell',
    'powershell',
    'PowerShellTool',
    'write',
    'Write',
    'FileWrite',
    'FileWriteTool',
    'edit',
    'Edit',
    'FileEdit',
    'FileEditTool',
    'convert',
    'FileConvert',
    'web_fetch',
    'WebFetch',
    'WebFetchTool',
    'web_search',
    'WebSearch',
    'WebSearchTool',
    'browser',
    'Browser',
    'BrowserTool',
    'send_message',
    'SendMessage',
    'SendMessageTool',
    'ask_user',
    'AskUserQuestion',
    'AskUserQuestionTool',
    'agent',
    'Agent',
    'AgentTool',
    'skill',
    'Skill',
    'SkillTool',
    'plan',
    'Plan',
    'PlanTool',
    'enter_plan_mode',
    'EnterPlanMode',
    'exit_plan_mode',
    'ExitPlanMode',
    'task_create',
    'TaskCreate',
    'task_stop',
    'TaskStop',
    'config',
    'Config',
    'ConfigTool',
    'monitor',
    'Monitor',
    'MonitorTool',
    'team_create',
    'TeamCreate',
    'TeamDelete',
  ],
};

export class RoleBasedToolPolicy implements ToolPolicy {
  readonly name = 'RoleBasedToolPolicy';
  private classifier: ToolClassifier;

  constructor(classifier?: ToolClassifier) {
    this.classifier = classifier ?? new ToolClassifier();
  }

  evaluate(tool: Tool, context: PolicyContext): PolicyResult {
    const role = context.userRole ?? 'guest';
    const toolName = tool.name;

    const deniedTools = ROLE_DENIED_TOOLS[role];
    if (deniedTools.some((n) => n.toLowerCase() === toolName.toLowerCase())) {
      logger.debug(`角色策略拒绝工具: ${toolName} (角色: ${role})`);
      return denyResult(this.name, `角色 ${role} 不允许使用工具 ${toolName}`);
    }

    const allowedCategories = ROLE_ALLOWED_CATEGORIES[role];
    const category = this.classifier.classify(tool);

    if (allowedCategories.has(category)) {
      return allowResult(this.name);
    }

    logger.debug(
      `角色策略拒绝工具: ${toolName} (分类: ${category}, 角色: ${role})`
    );
    return denyResult(
      this.name,
      `角色 ${role} 不允许使用分类 ${category} 的工具 ${toolName}`
    );
  }

  evaluateBatch(tools: Tool[], context: PolicyContext): PolicyResult[] {
    return tools.map((tool) => this.evaluate(tool, context));
  }
}
