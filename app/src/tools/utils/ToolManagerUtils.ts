/**
 * 工具管理工具
 * 提供函数式的工具管理方法
 */
import type { Tool } from '../types/Tool';
import { ToolFactory } from '../ToolFactory';
import {
  BUILTIN_TOOL_FACTORIES,
  type BuiltinToolFactoryKey,
} from '../factories/builtinToolRegistry';
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
 * G18（2026-10-11）：**注册表驱动的 loader 构造**。
 *
 * 以**注册表键**从 `BUILTIN_TOOL_FACTORIES` 取构造 thunk；语义与既有
 * `createToolLoader(ToolFactory.prototype.createXxxTool)` **逐字等价**
 * （同一 `try/catch` + `handleError`：`module:'tools:utils'`, `action:'createTool'`）。
 * 键为编译期字面量联合 ⇒ 拼错即 `typecheck` 失败。
 */
const byKey = (key: BuiltinToolFactoryKey): ToolLoader =>
  createToolLoader(function (this: ToolFactory) {
    return this.create(key);
  });

/**
 * 注册表键的只读清单（供门禁/自证断言：注册表 ↔ loader 清单一致性）。
 *
 * ⚠️ **函数**而非顶层常量：与本文件"清单惰性构建"约定一致 —— 顶层求值会触发
 * `BUILTIN_TOOL_FACTORIES` 的**循环导入 TDZ**（工具类 ↔ 本模块的依赖环）。
 */
export function getBuiltinToolFactoryKeys(): readonly BuiltinToolFactoryKey[] {
  return Object.keys(BUILTIN_TOOL_FACTORIES) as BuiltinToolFactoryKey[];
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
    byKey('createBashTool'),
    byKey('createFileReadTool'),
    byKey('createFileWriteTool'),
    byKey('createFileEditTool'),
    byKey('createFileConvertTool'),
    byKey('createGrepTool'),
    byKey('createGlobTool'),
    byKey('createTodoWriteTool'),
    byKey('createTaskStopTool'),
    byKey('createTaskCreateListTool'),
    byKey('createTaskUpdateStatusTool'),
    byKey('createTaskGetListTool'),
    byKey('createSkillTool'),
    // T9'（2026-08-30）：skills_list / skill_view 注册进 ToolManager loaders——
    // 此前仅存在于 getAllBaseTools() 工具池路径，未进入 ToolRegistry，导致
    // tool_search 搜不到 → 模型按 <available_skills> 引导反复搜索 → 工具循环
    byKey('createSkillListTool'),
    byKey('createSkillViewTool'),
    // 2026-09-01：知识库保存核心工具（系统能力封装，非技能旁路）
    byKey('createKnowledgeSaveTool'),
    byKey('createWebFetchTool'),
    byKey('createWebSearchTool'),
    byKey('createAgentTool'),
    byKey('createAskUserQuestionTool'),
    byKey('createBriefTool'),
    byKey('createSaveConversationTool'),

    // 会话管理工具
    byKey('createSessionsTool'),
    // 阶段 A（2026-09-20，N-27 修复）：`sessions_yield` 此前只注册在
    // `ToolFactory.getAllBaseTools()`（未被 ToolManager 使用的路径）⇒ 工具对模型不可见
    // （实测模型工具池只有 `sessions`）。此处补齐后经
    // `ToolManager.loadBuiltinTools()` → registry → 注入给模型。
    byKey('createSessionsYieldTool'),
    // N-37（2026-09-20）：自唤醒工具（sleep_for / sleep_until）此前零注册（其
    // SelfWakeTools.ts 只导出 schema + 执行器、全仓无引用）⇒ 调度 API 无生产者、
    // N-26 修好的「fire → 会话续跑」无触发场景。此处登记 TIMER 类的两个；
    // `wake_on_job` / `wake_on_event` 因无触发源**暂不注册**（CS04 禁止假能力）。
    byKey('createSleepForTool'),
    byKey('createSleepUntilTool'),
    byKey('createClipboardTool'),
    byKey('createDocGenerateTool'),
    byKey('createComputerUseTool'),

    // 媒体编辑工具
    byKey('createImageTool'),
    byKey('createImageAnalysisTool'),
    byKey('createImageGenerateTool'),
    byKey('createVideoAnalysisTool'),
    byKey('createBrowserVisionTool'),
    byKey('createImageSvgTool'),
    byKey('createImageDisplayTool'),
    byKey('createVideoDisplayTool'),
    byKey('createAudioPlayTool'),
    byKey('createCanvasTool'),
    byKey('createVideoTool'),
    byKey('createVideoGenerateTool'),
    byKey('createMusicTool'),

    // P0-2: 删除无条件注册 createNotebookEditTool（与下方 conditionalTool(NOTEBOOK) 重复，
    // 且无条件注册导致 NOTEBOOK=false 时 notebook 仍默认可用）；notebook 只保留一条条件注册
    // Notebook 编辑工具：见下方 cond(coreFeature('NOTEBOOK'), byKey('createNotebookTool'))

    // 通用工具
    byKey('createSleepTool'),
    byKey('createMonitorTool'),
    byKey('createTraceRecordingTool'),

    // Code Mode（code_run，默认关闭——CODE_MODE=false 时不注册）
    cond(coreFeature('CODE_MODE'), byKey('createCodeRunnerTool')),

    // 团队与消息工具 (工厂方法内部进行特性开关检查)
    byKey('createSendMessageTool'),
    byKey('createTeamCreateTool'),
    byKey('createTeamDeleteTool'),

    // 条件工具
    cond(coreFeature('POWERSHELL'), byKey('createPowerShellTool')),
    cond(coreFeature('LSP'), byKey('createLSPTool')),
    cond(coreFeature('MCP'), byKey('createMCPTool')),
    cond(coreFeature('MCP'), byKey('createMCPResourceTool')),
    // 2026-10-08：删除 `list_mcp_resources` / `read_mcp_resource` 两个加载器 —— 二者为**占位/伪造实现**
    // （前者 `fetchResourcesForClient()` 恒返回 []，后者直接编造 `Content of <uri>` 文本，属 CS04 违规），
    // 且功能被 `mcp_resource`（真实现，走 MCPServerManager.sendRequest）完全覆盖。
    cond(coreFeature('REPL'), byKey('createREPLTool')),
    cond(coreFeature('NOTEBOOK'), byKey('createNotebookTool')),
    cond(coreFeature('CONFIG'), byKey('createConfigTool')),
    // Tungsten 工具 (仅 ANT 用户)
    cond(isAntUser(), byKey('createTungstenTool')),
    cond(coreFeature('BROWSER'), byKey('createBrowserTool')),
    cond(coreFeature('PLAN'), byKey('createPlanTool')),

    // 其他条件工具
    cond(coreFeature('AGENT_TRIGGERS'), byKey('createCronCreateTool')),
    cond(coreFeature('AGENT_TRIGGERS'), byKey('createCronDeleteTool')),
    cond(coreFeature('AGENT_TRIGGERS'), byKey('createCronListTool')),
    cond(coreFeature('AGENT_TRIGGERS'), byKey('createCronStopTool')),
    // S3-2（G19 / CD05，2026-10-11）：4 个**恒返回 `null`** 的死桩入口已摘除，且其实现体（步骤②）
    // 亦已删除 —— `createRemoteTriggerTool` / `createSendUserFileTool` / `createSnipTool` /
    // `createWorkflowTool` 均已从注册表与 `ToolFactory` 移除（含 `WORKFLOW_SCRIPTS`/`ENABLE_WORKFLOWS` 死特性位）。
    // 回滚：`git revert` 本提交（删除落在独立提交，符合 CD06）。
    // 2026-09-29 D-29 去重：删 `cond(coreFeature('MONITOR_TOOL'), …createMonitorTool)` ——
    // `MonitorTool` 上方（「通用工具」段）**已有无条件项** ⇒ 此处为**重复注册**
    // （且因无条件项已存在，删除本项**不改变行为**：flag 为假时该工具本来也已注册）。
    cond(coreFeature('KAIROS'), byKey('createPushNotificationTool')),
    cond(coreFeature('KAIROS_GITHUB_WEBHOOKS'), byKey('createSubscribePRTool')),
    cond(coreFeature('UDS_INBOX'), byKey('createListPeersTool')),
    cond(coreFeature('TOOL_SEARCH'), byKey('createToolSearchTool')),
    cond(coreFeature('WORKTREE'), byKey('createEnterWorktreeTool')),
    cond(coreFeature('WORKTREE'), byKey('createExitWorktreeTool')),

    // 项目创建工具
    byKey('createProjectTool'),

    // 项目文件读写工具
    byKey('createReadProjectFileTool'),
    byKey('createWriteProjectFileTool'),

    // AI-VFS 系统调用工具（2026-10-08 只读试点）：命名空间 read/list/stat/write_vfs。
    // ⚠️ 挂载点装配在 `entrypoints/vfsWiring.ts`（组合根）—— 未装配时工具会明确返回
    // `VFS_UNKNOWN_MOUNT`，不回退本地文件系统（CS03）。
    //
    // D7（2026-10-11 用户裁定「①+④ 组合」）：**文件类** VFS 工具默认**不注册**（`VFS_ENABLED=false`）
    // ⇒ 默认工具面只有 `file_read`/`file_write`/`glob`，消除与 VFS 的"事实源双轨"（G21）。
    // `stat_vfs` **保持无条件**（元数据探测，与文件工具不重叠）。
    // 回滚（CD06）/显式启用：`FEATURE_VFS_ENABLED=true`。
    cond(coreFeature('VFS_ENABLED'), byKey('createReadVfsTool')),
    cond(coreFeature('VFS_ENABLED'), byKey('createListVfsTool')),
    byKey('createStatVfsTool'),
    cond(coreFeature('VFS_ENABLED'), byKey('createWriteVfsTool')),

    // 通道/网关工具（2026-09-29 D-29 去重：删 `createGatewayTool` —— 它与
    // `createChannelManagerTool` **返回同一个 `new ChannelTool()`** ⇒ 同名 `channel` 注册两次）
    byKey('createChannelManagerTool'),
    byKey('createBroadcastTool'),
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
