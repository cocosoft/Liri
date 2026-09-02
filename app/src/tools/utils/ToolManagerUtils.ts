/**
 * 工具管理工具
 * 提供函数式的工具管理方法
 */
import type { Tool } from '../types/Tool';
import { ToolFactory } from '../ToolFactory';
import { feature as coreFeature } from '@modules/core';
import { isAntUser } from '@modules/utils/features.js';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('tools:managerUtils');

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
      void handleError(
        error instanceof Error ? error : new Error(String(error)),
        {
          module: 'tools:utils',
          action: 'createTool',
        }
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
 * 获取内置工具加载器列表（延迟初始化，避免与 ToolFactory 的循环依赖）
 */
export function getBuiltinToolLoaders(): ToolLoader[] {
  return [
    // 核心工具
    createToolLoader(ToolFactory.prototype.createBashTool),
    createToolLoader(ToolFactory.prototype.createFileReadTool),
    createToolLoader(ToolFactory.prototype.createFileWriteTool),
    createToolLoader(ToolFactory.prototype.createFileEditTool),
    createToolLoader(ToolFactory.prototype.createFileConvertTool),
    createToolLoader(ToolFactory.prototype.createGrepTool),
    createToolLoader(ToolFactory.prototype.createGlobTool),
    createToolLoader(ToolFactory.prototype.createTodoWriteTool),
    createToolLoader(ToolFactory.prototype.createTaskStopTool),
    createToolLoader(ToolFactory.prototype.createTaskCreateListTool),
    createToolLoader(ToolFactory.prototype.createTaskUpdateStatusTool),
    createToolLoader(ToolFactory.prototype.createTaskGetListTool),
    createToolLoader(ToolFactory.prototype.createSkillTool),
    // T9'（2026-08-30）：skills_list / skill_view 注册进 ToolManager loaders——
    // 此前仅存在于 getAllBaseTools() 工具池路径，未进入 ToolRegistry，导致
    // tool_search 搜不到 → 模型按 <available_skills> 引导反复搜索 → 工具循环
    createToolLoader(ToolFactory.prototype.createSkillListTool),
    createToolLoader(ToolFactory.prototype.createSkillViewTool),
    // 2026-09-01：知识库保存核心工具（系统能力封装，非技能旁路）
    createToolLoader(ToolFactory.prototype.createKnowledgeSaveTool),
    createToolLoader(ToolFactory.prototype.createWebFetchTool),
    createToolLoader(ToolFactory.prototype.createWebSearchTool),
    createToolLoader(ToolFactory.prototype.createAgentTool),
    createToolLoader(ToolFactory.prototype.createAskUserQuestionTool),
    createToolLoader(ToolFactory.prototype.createBriefTool),
    createToolLoader(ToolFactory.prototype.createSaveConversationTool),

    // 会话管理工具
    createToolLoader(ToolFactory.prototype.createSessionsTool),
    createToolLoader(ToolFactory.prototype.createClipboardTool),
    createToolLoader(ToolFactory.prototype.createDocGenerateTool),
    createToolLoader(ToolFactory.prototype.createComputerUseTool),

    // 媒体编辑工具
    createToolLoader(ToolFactory.prototype.createImageTool),
    createToolLoader(ToolFactory.prototype.createImageAnalysisTool),
    createToolLoader(ToolFactory.prototype.createImageGenerateTool),
    createToolLoader(ToolFactory.prototype.createVideoAnalysisTool),
    createToolLoader(ToolFactory.prototype.createBrowserVisionTool),
    createToolLoader(ToolFactory.prototype.createImageSvgTool),
    createToolLoader(ToolFactory.prototype.createImageDisplayTool),
    createToolLoader(ToolFactory.prototype.createVideoDisplayTool),
    createToolLoader(ToolFactory.prototype.createAudioPlayTool),
    createToolLoader(ToolFactory.prototype.createCanvasTool),
    createToolLoader(ToolFactory.prototype.createVideoTool),
    createToolLoader(ToolFactory.prototype.createVideoGenerateTool),
    createToolLoader(ToolFactory.prototype.createMusicTool),

    // P0-2: 删除无条件注册 createNotebookEditTool（与下方 conditionalTool(NOTEBOOK) 重复，
    // 且无条件注册导致 NOTEBOOK=false 时 notebook 仍默认可用）；notebook 只保留一条条件注册
    // Notebook 编辑工具：见下方 conditionalTool(coreFeature('NOTEBOOK'), createNotebookTool)

    // 通用工具
    createToolLoader(ToolFactory.prototype.createSleepTool),
    createToolLoader(ToolFactory.prototype.createMonitorTool),
    createToolLoader(ToolFactory.prototype.createTraceRecordingTool),

    // Code Mode（code_run，默认关闭——CODE_MODE=false 时不注册）
    conditionalTool(
      coreFeature('CODE_MODE'),
      createToolLoader(ToolFactory.prototype.createCodeRunnerTool)
    ),

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
      coreFeature('AGENT_TRIGGERS'),
      createToolLoader(ToolFactory.prototype.createCronStopTool)
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

    // 项目创建工具
    createToolLoader(ToolFactory.prototype.createProjectTool),

    // 项目文件读写工具
    createToolLoader(ToolFactory.prototype.createReadProjectFileTool),
    createToolLoader(ToolFactory.prototype.createWriteProjectFileTool),

    // 通道/网关工具
    createToolLoader(ToolFactory.prototype.createGatewayTool),
    createToolLoader(ToolFactory.prototype.createChannelManagerTool),
    createToolLoader(ToolFactory.prototype.createBroadcastTool),
  ];
}

/**
 * 加载所有内置工具
 */
export function loadBuiltinTools(factory: ToolFactory): Tool[] {
  return loadTools(factory, getBuiltinToolLoaders());
}
