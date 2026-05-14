/**
 * 工具管理工具
 * 提供函数式的工具管理方法
 */
import type { Tool } from '../types/Tool';
import { ToolFactory } from '../ToolFactory';
import { feature as coreFeature } from '@modules/core';
import { isAntUser } from '@modules/utils/features.js';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 工具加载器类型
 */
export type ToolLoader = (factory: ToolFactory) => Tool | null;

/**
 * 条件工具加载器
 */
export function conditionalTool(
  condition: boolean,
  loader: ToolLoader
): ToolLoader {
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
export function createToolLoader<T extends (...args: any[]) => Tool | null>(
  creator: T
): ToolLoader {
  return (factory: ToolFactory) => {
    try {
      return creator.call(factory);
    } catch (error) {
      logger.error(
        'Failed to create tool',
        error instanceof Error ? error : new Error(String(error))
      );
      return null;
    }
  };
}

/**
 * 加载工具列表
 */
export function loadTools(factory: ToolFactory, loaders: ToolLoader[]): Tool[] {
  return loaders
    .map((loader) => loader(factory))
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
  createToolLoader(ToolFactory.prototype.createFileConvertTool),
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

  // 会话管理工具
  createToolLoader(ToolFactory.prototype.createSessionsTool),
  createToolLoader(ToolFactory.prototype.createClipboardTool),

  // 媒体编辑工具
  createToolLoader(ToolFactory.prototype.createImageTool),
  createToolLoader(ToolFactory.prototype.createVideoTool),
  createToolLoader(ToolFactory.prototype.createMusicTool),

  // Notebook 编辑工具
  createToolLoader(ToolFactory.prototype.createNotebookEditTool),

  // 通用工具
  createToolLoader(ToolFactory.prototype.createSleepTool),
  createToolLoader(ToolFactory.prototype.createMonitorTool),
  createToolLoader(ToolFactory.prototype.createTraceRecordingTool),

  // 团队与消息工具 (工厂方法内部进行特性开关检查)
  createToolLoader(ToolFactory.prototype.createSendMessageTool),
  createToolLoader(ToolFactory.prototype.createTeamCreateTool),
  createToolLoader(ToolFactory.prototype.createTeamDeleteTool),

  // 条件工具
  conditionalTool(
    coreFeature('POWERSHELL'),
    createToolLoader(ToolFactory.prototype.createPowerShellTool)
  ),
  conditionalTool(
    coreFeature('LSP'),
    createToolLoader(ToolFactory.prototype.createLSPTool)
  ),
  conditionalTool(
    coreFeature('MCP'),
    createToolLoader(ToolFactory.prototype.createMCPTool)
  ),
  conditionalTool(
    coreFeature('MCP'),
    createToolLoader(ToolFactory.prototype.createMCPResourceTool)
  ),
  conditionalTool(
    coreFeature('MCP'),
    createToolLoader(ToolFactory.prototype.createListMcpResourcesTool)
  ),
  conditionalTool(
    coreFeature('MCP'),
    createToolLoader(ToolFactory.prototype.createReadMcpResourceTool)
  ),
  conditionalTool(
    coreFeature('REPL'),
    createToolLoader(ToolFactory.prototype.createREPLTool)
  ),
  conditionalTool(
    coreFeature('NOTEBOOK'),
    createToolLoader(ToolFactory.prototype.createNotebookTool)
  ),
  conditionalTool(
    coreFeature('CONFIG'),
    createToolLoader(ToolFactory.prototype.createConfigTool)
  ),
  // Tungsten 工具 (仅 ANT 用户)
  conditionalTool(
    isAntUser(),
    createToolLoader(ToolFactory.prototype.createTungstenTool)
  ),
  conditionalTool(
    coreFeature('BROWSER'),
    createToolLoader(ToolFactory.prototype.createBrowserTool)
  ),
  conditionalTool(
    coreFeature('PLAN'),
    createToolLoader(ToolFactory.prototype.createPlanTool)
  ),

  // 其他条件工具
  conditionalTool(
    coreFeature('AGENT_TRIGGERS'),
    createToolLoader(ToolFactory.prototype.createCronCreateTool)
  ),
  conditionalTool(
    coreFeature('AGENT_TRIGGERS'),
    createToolLoader(ToolFactory.prototype.createCronDeleteTool)
  ),
  conditionalTool(
    coreFeature('AGENT_TRIGGERS'),
    createToolLoader(ToolFactory.prototype.createCronListTool)
  ),
  conditionalTool(
    coreFeature('AGENT_TRIGGERS_REMOTE'),
    createToolLoader(ToolFactory.prototype.createRemoteTriggerTool)
  ),
  conditionalTool(
    coreFeature('MONITOR_TOOL'),
    createToolLoader(ToolFactory.prototype.createMonitorTool)
  ),
  conditionalTool(
    coreFeature('KAIROS'),
    createToolLoader(ToolFactory.prototype.createSendUserFileTool)
  ),
  conditionalTool(
    coreFeature('KAIROS'),
    createToolLoader(ToolFactory.prototype.createPushNotificationTool)
  ),
  conditionalTool(
    coreFeature('KAIROS_GITHUB_WEBHOOKS'),
    createToolLoader(ToolFactory.prototype.createSubscribePRTool)
  ),
  conditionalTool(
    coreFeature('HISTORY_SNIP'),
    createToolLoader(ToolFactory.prototype.createSnipTool)
  ),
  conditionalTool(
    coreFeature('UDS_INBOX'),
    createToolLoader(ToolFactory.prototype.createListPeersTool)
  ),
  conditionalTool(
    coreFeature('WORKFLOW_SCRIPTS'),
    createToolLoader(ToolFactory.prototype.createWorkflowTool)
  ),
  conditionalTool(
    coreFeature('TOOL_SEARCH'),
    createToolLoader(ToolFactory.prototype.createToolSearchTool)
  ),
  conditionalTool(
    coreFeature('WORKTREE'),
    createToolLoader(ToolFactory.prototype.createEnterWorktreeTool)
  ),
  conditionalTool(
    coreFeature('WORKTREE'),
    createToolLoader(ToolFactory.prototype.createExitWorktreeTool)
  ),
];

/**
 * 加载所有内置工具
 */
export function loadBuiltinTools(factory: ToolFactory): Tool[] {
  return loadTools(factory, builtinToolLoaders);
}
