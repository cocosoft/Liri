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
 * 构建内置工具加载器清单 —— **单一事实源**（P2-3，2026-09-29）。
 *
 * @param includeConditionalDisabled `true` ⇒ **条件工具也返回其加载器**（**与 flag 无关的全量视图**），
 *   供**工具名生成器**（`app/scripts/gen-tool-names.ts`）与门禁比对使用 ⇒ **生成物不随 flag/环境变化**；
 *   `false` ⇒ 保持既有语义（条件不满足 ⇒ 该位置返回 `null` 加载器，运行时自然被过滤）。
 *
 * ⚠️ 两处如实说明：
 * 1. 全量视图下条件表达式**仍会被求值**（JS 实参先求值），但其结果被**丢弃** ⇒ 视图**与 flag 无关**；
 * 2. 清单**仍在每次调用时构建**（不提到模块顶层）—— 避免把条件求值提前到模块加载期（TDZ / 读 flag 过早）。
 */
function buildBuiltinToolLoaders(
  includeConditionalDisabled: boolean
): ToolLoader[] {
  /** 条件包装：全量视图下直接返回加载器（丢弃条件） */
  const cond = (condition: boolean, loader: ToolLoader): ToolLoader =>
    includeConditionalDisabled ? loader : conditionalTool(condition, loader);

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
    // 阶段 A（2026-09-20，N-27 修复）：`sessions_yield` 此前只注册在
    // `ToolFactory.getAllBaseTools()`（未被 ToolManager 使用的路径）⇒ 工具对模型不可见
    // （实测模型工具池只有 `sessions`）。此处补齐后经
    // `ToolManager.loadBuiltinTools()` → registry → 注入给模型。
    createToolLoader(ToolFactory.prototype.createSessionsYieldTool),
    // N-37（2026-09-20）：自唤醒工具（sleep_for / sleep_until）此前零注册（其
    // SelfWakeTools.ts 只导出 schema + 执行器、全仓无引用）⇒ 调度 API 无生产者、
    // N-26 修好的「fire → 会话续跑」无触发场景。此处登记 TIMER 类的两个；
    // `wake_on_job` / `wake_on_event` 因无触发源**暂不注册**（CS04 禁止假能力）。
    createToolLoader(ToolFactory.prototype.createSleepForTool),
    createToolLoader(ToolFactory.prototype.createSleepUntilTool),
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
    cond(
      coreFeature('CODE_MODE'),
      createToolLoader(ToolFactory.prototype.createCodeRunnerTool)
    ),

    // 团队与消息工具 (工厂方法内部进行特性开关检查)
    createToolLoader(ToolFactory.prototype.createSendMessageTool),
    createToolLoader(ToolFactory.prototype.createTeamCreateTool),
    createToolLoader(ToolFactory.prototype.createTeamDeleteTool),

    // 条件工具
    cond(
      coreFeature('POWERSHELL'),
      createToolLoader(ToolFactory.prototype.createPowerShellTool)
    ),
    cond(
      coreFeature('LSP'),
      createToolLoader(ToolFactory.prototype.createLSPTool)
    ),
    cond(
      coreFeature('MCP'),
      createToolLoader(ToolFactory.prototype.createMCPTool)
    ),
    cond(
      coreFeature('MCP'),
      createToolLoader(ToolFactory.prototype.createMCPResourceTool)
    ),
    cond(
      coreFeature('MCP'),
      createToolLoader(ToolFactory.prototype.createListMcpResourcesTool)
    ),
    cond(
      coreFeature('MCP'),
      createToolLoader(ToolFactory.prototype.createReadMcpResourceTool)
    ),
    cond(
      coreFeature('REPL'),
      createToolLoader(ToolFactory.prototype.createREPLTool)
    ),
    cond(
      coreFeature('NOTEBOOK'),
      createToolLoader(ToolFactory.prototype.createNotebookTool)
    ),
    cond(
      coreFeature('CONFIG'),
      createToolLoader(ToolFactory.prototype.createConfigTool)
    ),
    // Tungsten 工具 (仅 ANT 用户)
    cond(
      isAntUser(),
      createToolLoader(ToolFactory.prototype.createTungstenTool)
    ),
    cond(
      coreFeature('BROWSER'),
      createToolLoader(ToolFactory.prototype.createBrowserTool)
    ),
    cond(
      coreFeature('PLAN'),
      createToolLoader(ToolFactory.prototype.createPlanTool)
    ),

    // 其他条件工具
    cond(
      coreFeature('AGENT_TRIGGERS'),
      createToolLoader(ToolFactory.prototype.createCronCreateTool)
    ),
    cond(
      coreFeature('AGENT_TRIGGERS'),
      createToolLoader(ToolFactory.prototype.createCronDeleteTool)
    ),
    cond(
      coreFeature('AGENT_TRIGGERS'),
      createToolLoader(ToolFactory.prototype.createCronListTool)
    ),
    cond(
      coreFeature('AGENT_TRIGGERS'),
      createToolLoader(ToolFactory.prototype.createCronStopTool)
    ),
    cond(
      coreFeature('AGENT_TRIGGERS_REMOTE'),
      createToolLoader(ToolFactory.prototype.createRemoteTriggerTool)
    ),
    // 2026-09-29 D-29 去重：删 `cond(coreFeature('MONITOR_TOOL'), createMonitorTool)` ——
    // `MonitorTool` 上方（「通用工具」段）**已有无条件项** ⇒ 此处为**重复注册**
    // （且因无条件项已存在，删除本项**不改变行为**：flag 为假时该工具本来也已注册）。
    cond(
      coreFeature('KAIROS'),
      createToolLoader(ToolFactory.prototype.createSendUserFileTool)
    ),
    cond(
      coreFeature('KAIROS'),
      createToolLoader(ToolFactory.prototype.createPushNotificationTool)
    ),
    cond(
      coreFeature('KAIROS_GITHUB_WEBHOOKS'),
      createToolLoader(ToolFactory.prototype.createSubscribePRTool)
    ),
    cond(
      coreFeature('HISTORY_SNIP'),
      createToolLoader(ToolFactory.prototype.createSnipTool)
    ),
    cond(
      coreFeature('UDS_INBOX'),
      createToolLoader(ToolFactory.prototype.createListPeersTool)
    ),
    cond(
      coreFeature('WORKFLOW_SCRIPTS'),
      createToolLoader(ToolFactory.prototype.createWorkflowTool)
    ),
    cond(
      coreFeature('TOOL_SEARCH'),
      createToolLoader(ToolFactory.prototype.createToolSearchTool)
    ),
    cond(
      coreFeature('WORKTREE'),
      createToolLoader(ToolFactory.prototype.createEnterWorktreeTool)
    ),
    cond(
      coreFeature('WORKTREE'),
      createToolLoader(ToolFactory.prototype.createExitWorktreeTool)
    ),

    // 项目创建工具
    createToolLoader(ToolFactory.prototype.createProjectTool),

    // 项目文件读写工具
    createToolLoader(ToolFactory.prototype.createReadProjectFileTool),
    createToolLoader(ToolFactory.prototype.createWriteProjectFileTool),

    // 通道/网关工具（2026-09-29 D-29 去重：删 `createGatewayTool` —— 它与
    // `createChannelManagerTool` **返回同一个 `new ChannelTool()`** ⇒ 同名 `channel` 注册两次）
    createToolLoader(ToolFactory.prototype.createChannelManagerTool),
    createToolLoader(ToolFactory.prototype.createBroadcastTool),
  ];
}

/** **生效视图**（既有语义，行为不变）：条件不满足的位置返回 `null` 加载器 */
export function getBuiltinToolLoaders(): ToolLoader[] {
  return buildBuiltinToolLoaders(false);
}

/**
 * **全量视图**（含**条件工具**，**与 flag 无关**）。
 *
 * ⚠️ **仅供**工具名生成器 / 门禁比对使用；❌ **不要**用它做运行时加载（会把未启用的工具注册进来）。
 */
export function getAllBuiltinToolLoaders(): ToolLoader[] {
  return buildBuiltinToolLoaders(true);
}

/**
 * 加载所有内置工具
 */
export function loadBuiltinTools(factory: ToolFactory): Tool[] {
  return loadTools(factory, getBuiltinToolLoaders());
}
