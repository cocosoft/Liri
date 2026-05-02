/**
 * 工具管理工具
 * 提供函数式的工具管理方法
 */
import type { Tool } from '../types/Tool';
import { ToolFactory } from '../ToolFactory';

/**
 * 功能标志检查函数
 */
export function feature(name: string): boolean {
  return process.env[`FEATURE_${name.toUpperCase()}`] === 'true';
}

/**
 * 工具加载器类型
 */
export type ToolLoader = (factory: ToolFactory) => Tool | null;

/**
 * 条件工具加载器
 */
export function conditionalTool(condition: boolean, loader: ToolLoader): ToolLoader {
  return (factory: ToolFactory) => {
    if (condition) {
      return loader(factory);
    }
    return null;
  };
}

/**
 * 创建工具加载器
 */
export function createToolLoader<T extends (...args: any[]) => Tool>(creator: T): ToolLoader {
  return (factory: ToolFactory) => {
    try {
      return creator.call(factory);
    } catch (error) {
      console.error(`Failed to create tool:`, error);
      return null;
    }
  };
}

/**
 * 加载工具列表
 */
export function loadTools(
  factory: ToolFactory,
  loaders: ToolLoader[]
): Tool[] {
  return loaders
    .map(loader => loader(factory))
    .filter((tool): tool is Tool => tool !== null);
}

/**
 * 内置工具加载器列表
 */
export const builtinToolLoaders: ToolLoader[] = [
  // 核心工具
  createToolLoader(ToolFactory.prototype.createBashTool),
  createToolLoader(ToolFactory.prototype.createFileReadTool),
  createToolLoader(ToolFactory.prototype.createFileWriteTool),
  createToolLoader(ToolFactory.prototype.createFileEditTool),
  createToolLoader(ToolFactory.prototype.createGrepTool),
  createToolLoader(ToolFactory.prototype.createGlobTool),
  createToolLoader(ToolFactory.prototype.createTodoWriteTool),
  createToolLoader(ToolFactory.prototype.createTaskCreateTool),
  createToolLoader(ToolFactory.prototype.createTaskListTool),
  createToolLoader(ToolFactory.prototype.createTaskGetTool),
  createToolLoader(ToolFactory.prototype.createTaskUpdateTool),
  createToolLoader(ToolFactory.prototype.createTaskStopTool),
  createToolLoader(ToolFactory.prototype.createSkillTool),
  createToolLoader(ToolFactory.prototype.createWebFetchTool),
  createToolLoader(ToolFactory.prototype.createWebSearchTool),
  createToolLoader(ToolFactory.prototype.createAgentTool),
  createToolLoader(ToolFactory.prototype.createAskUserQuestionTool),
  createToolLoader(ToolFactory.prototype.createBriefTool),
  
  // 通用工具
  createToolLoader(ToolFactory.prototype.createSleepTool),
  createToolLoader(ToolFactory.prototype.createMonitorTool),
  
  // 条件工具
  conditionalTool(feature('POWERSHELL'), createToolLoader(ToolFactory.prototype.createPowerShellTool)),
  conditionalTool(feature('LSP'), createToolLoader(ToolFactory.prototype.createLSPTool)),
  conditionalTool(feature('MCP'), createToolLoader(ToolFactory.prototype.createMCPTool)),
  conditionalTool(feature('MCP'), createToolLoader(ToolFactory.prototype.createMCPResourceTool)),
  conditionalTool(feature('REPL'), createToolLoader(ToolFactory.prototype.createREPLTool)),
  conditionalTool(feature('NOTEBOOK'), createToolLoader(ToolFactory.prototype.createNotebookTool)),
  conditionalTool(feature('CONFIG'), createToolLoader(ToolFactory.prototype.createConfigTool)),
  conditionalTool(feature('BROWSER'), createToolLoader(ToolFactory.prototype.createBrowserTool)),
  conditionalTool(feature('PLAN'), createToolLoader(ToolFactory.prototype.createPlanTool)),
  
  // 其他条件工具
  conditionalTool(feature('AGENT_TRIGGERS'), createToolLoader(ToolFactory.prototype.createCronCreateTool)),
  conditionalTool(feature('AGENT_TRIGGERS'), createToolLoader(ToolFactory.prototype.createCronDeleteTool)),
  conditionalTool(feature('AGENT_TRIGGERS'), createToolLoader(ToolFactory.prototype.createCronListTool)),
  conditionalTool(feature('AGENT_TRIGGERS_REMOTE'), createToolLoader(ToolFactory.prototype.createRemoteTriggerTool)),
  conditionalTool(feature('MONITOR_TOOL'), createToolLoader(ToolFactory.prototype.createMonitorTool)),
  conditionalTool(feature('KAIROS'), createToolLoader(ToolFactory.prototype.createSendUserFileTool)),
  conditionalTool(feature('KAIROS'), createToolLoader(ToolFactory.prototype.createPushNotificationTool)),
  conditionalTool(feature('KAIROS_GITHUB_WEBHOOKS'), createToolLoader(ToolFactory.prototype.createSubscribePRTool)),
  conditionalTool(feature('HISTORY_SNIP'), createToolLoader(ToolFactory.prototype.createSnipTool)),
  conditionalTool(feature('UDS_INBOX'), createToolLoader(ToolFactory.prototype.createListPeersTool)),
  conditionalTool(feature('WORKFLOW_SCRIPTS'), createToolLoader(ToolFactory.prototype.createWorkflowTool)),
  conditionalTool(feature('TOOL_SEARCH'), createToolLoader(ToolFactory.prototype.createToolSearchTool)),
  conditionalTool(feature('WORKTREE'), createToolLoader(ToolFactory.prototype.createEnterWorktreeTool)),
  conditionalTool(feature('WORKTREE'), createToolLoader(ToolFactory.prototype.createExitWorktreeTool)),
];

/**
 * 加载所有内置工具
 */
export function loadBuiltinTools(factory: ToolFactory): Tool[] {
  return loadTools(factory, builtinToolLoaders);
}
