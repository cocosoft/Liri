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
import { feature as coreFeature } from '@openliri/kernel';
import { isAntUser } from '@modules/utils/features.js';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';
import { SidecarLspTool } from '../sidecar/SidecarLspTool';

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
 * `core` 变体的**工具面下限**（7 项，变体矩阵方案 §3.1）。
 *
 * 口径：`core` 是"PC 上最小能干活的那份 Liri"——能看、能改、能执行、能搜、能问。
 * 生效条件只有 `CORE_MINIMAL`（由 `scripts/variant-matrix.ts` 的 `minimalToolSurface` 生成，
 * **仅 core 为 true**）；其余变体不受影响（零行为变更）。
 *
 * ⚠️ 这是**装配点**判定（§5 规则 2）：工具实现内部不得自审变体。
 */
const CORE_MINIMAL_TOOL_KEYS: readonly BuiltinToolFactoryKey[] = [
  'createBashTool',
  'createFileReadTool',
  'createFileWriteTool',
  'createFileEditTool',
  'createGrepTool',
  'createGlobTool',
  'createAskUserQuestionTool',
];

/**
 * 工具侧车（P1 常驻 LSP）**双跑 loader 选择**（S2：真接线，spec §3-D4 / §6.1）。
 *
 * · `TOOL_SIDECAR_LSP` **关**（默认）⇒ **内置 loader**（`byKey('createLSPTool')`）——
 *   与现状**逐字等价**，且**不启动任何侧车进程**（loader 构造期不产生副作用）。
 * · `TOOL_SIDECAR_LSP` **开** ⇒ **侧车 loader**（`SidecarLspTool`）：`execute` 时经
 *   `maybeStartLspSidecar()` 确保常驻侧车就绪（**启动层门控**：仅开关为真时才 `spawn`），
 *   并把工具调用翻译为 sidecar `request`（结果形状与内置一致）。
 *   侧车不可用 / 握手失败 / 方法未实现 ⇒ 适配器内 **fail-closed 报错**
 *   （**不**回落内置"每次 spawn"路径 ⇒ 规避 spec §2「静默双轨」反目标；CS03）。
 */
function selectLspToolLoader(): ToolLoader {
  if (!coreFeature('TOOL_SIDECAR_LSP')) return byKey('createLSPTool');
  return createToolLoader(() => new SidecarLspTool());
}

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

  // `core` 变体：工具面收敛为 7 项下限（`CORE_MINIMAL` 由矩阵生成，仅 core 为 true）。
  // 全量视图**不裁**（`gen-tool-names` 与门禁比对必须与 flag 无关，否则生成物会随变体漂移）。
  if (!includeConditionalDisabled && coreFeature('CORE_MINIMAL')) {
    return CORE_MINIMAL_TOOL_KEYS.map((key) => byKey(key));
  }

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
    // P1（2026-10-30）：`create_task_list` / `get_task_list` / `update_task_status`
    // ⇒ 合并为 `task_list`（op=create|get|update；旧名保留为 alias）
    byKey('createTaskListFamilyTool'),
    // P4b（2026-10-16）：`task_output` 从「影子工具」接线进注册面（见 P4a 评估 §2.2(1)）——
    // 它读 `taskRegistry` 的真任务输出，且 `AgentTool/prompt.ts` 与 `ToolUIRegistry` 早已引用其名。
    byKey('createTaskOutputTool'),
    // P4b（2026-10-23，Q-18 `rewrite` 处置）：`kanban` 由影子工具接线 ——
    // 数据源 = SQLite `kanban_cards`（与 `/v1/kanban`、客户端 `KanbanBoard` 同源），
    // 消除原进程内 Map 双轨（模型建的卡界面看不见、重启即丢）。
    byKey('createKanbanTool'),
    // P1（2026-10-30）：`skill` / `skill_view` / `skills_list` ⇒ 合并为 `skill`（op=run|view|list）；
    // 旧名保留为 alias（`tool_search` 的 select 与旧提示词仍可命中）。
    byKey('createSkillFamilyTool'),
    // 2026-09-01：知识库保存核心工具（系统能力封装，非技能旁路）
    byKey('createKnowledgeSaveTool'),
    byKey('createWebFetchTool'),
    byKey('createWebSearchTool'),
    byKey('createAgentTool'),
    // P4b（2026-10-23，Q-18 `rewrite` 处置）：`agents_list` 由影子工具接线 ——
    // 数据源 = `AgentTool.getActiveAgents()`（与 `GET /v1/agents/control` 同源），
    // 只读；修复前实现返回硬编码空结果（CS04 假数据）。
    byKey('createAgentsListTool'),
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
    // P1（2026-10-30）：`sleep` / `sleep_for` / `sleep_until` ⇒ 合并为 `sleep`（mode=duration|wake|until）；
    // 旧名保留为 alias。自唤醒两个分支的「无 sessionId / 服务未初始化 ⇒ 明确失败」语义未变。
    byKey('createSleepFamilyTool'),
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
    // P4b（2026-10-23，Q-18 `rewrite` 处置）：`tts` 接线 —— 真实 `voiceService`
    // （speak / list-voices / save）；与 `VoiceOutputTool` 的**唯一归属**定为 tts（功能为超集）。
    byKey('createTTSTool'),

    // P0-2: 删除无条件注册 createNotebookEditTool（与下方 conditionalTool(NOTEBOOK) 重复，
    // 且无条件注册导致 NOTEBOOK=false 时 notebook 仍默认可用）；notebook 只保留一条条件注册
    // Notebook 编辑工具：见下方 cond(coreFeature('NOTEBOOK'), byKey('createNotebookTool'))

    // 通用工具（P1：`sleep` 已并入 sleep 族，见上方 `createSleepFamilyTool`）
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
    cond(coreFeature('LSP'), selectLspToolLoader()),
    cond(coreFeature('MCP'), byKey('createMCPTool')),
    cond(coreFeature('MCP'), byKey('createMCPResourceTool')),
    // P4b（2026-10-23，Q-18 `rewrite` 处置）：`mcp_auth` 接线 —— 经 `mcpAuthManager`
    // （login 返回授权 URL / status·list 读 hasToken / logout 撤销）。**D 类门控**：
    // 仅 `MCP_OAUTH` 开启时注册（默认关 ⇒ 运行期不出现；生成物按全量视图仍含该名）。
    cond(coreFeature('MCP_OAUTH'), byKey('createMcpAuthTool')),
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
    // 2026-10-16：`propose_plan` 已**下线**（用户裁定：与 `ask_user_question` 的审批入口合并，
    // 审批语义由 `ask_user_question(questionType='confirm')` 承接）⇒ 移除其 loader 与工厂。
    // 回滚（CD06）：`git revert` 本提交即可恢复（loader + 工厂 + 类别 + effects + 常量 + 实现体同批移除）。
    // P4b（2026-10-16，P4a 评估 §2.2(3)）：`pdf` 从影子工具接线（唯一 PDF 生成器；
    // prompt「交付物落点口径」已把它列为生成类工具）。**无条件注册**：它与任何 flag 无关，
    // 且 `extract`/`info` 两个未实现分支已同日收口为 fail-closed（不再是假成功）。
    byKey('createPDFTool'),

    // 其他条件工具
    // P1（2026-10-30）：cron 四件 ⇒ 合并为 `cron`（op=create|list|stop|delete；旧名保留为 alias）
    cond(coreFeature('AGENT_TRIGGERS'), byKey('createCronFamilyTool')),
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
    // P1（2026-10-30）：worktree 进出两件 ⇒ 合并为 `worktree`（op=enter|exit；旧名保留为 alias）
    cond(coreFeature('WORKTREE'), byKey('createWorktreeFamilyTool')),

    // 项目创建工具
    byKey('createProjectTool'),

    // 项目文件读写工具
    byKey('createReadProjectFileTool'),
    byKey('createWriteProjectFileTool'),

    // AI-VFS 系统调用工具：`vfs`（op=read|list|stat|write；旧名保留为 alias）。
    // ⚠️ 挂载点装配在 `entrypoints/vfsWiring.ts`（组合根）—— 未装配时 read/list/stat/write
    // 都会明确返回 `VFS_UNKNOWN_MOUNT`，不回退本地文件系统（CS03）。
    //
    // D7（2026-10-11 用户裁定「①+④ 组合」）：**文件类** VFS 工具默认**不注册**（`VFS_ENABLED=false`）
    // ⇒ 默认工具面只有 `file_read`/`file_write`/`glob`，消除与 VFS 的"事实源双轨"（G21）。
    // P1（2026-10-30）合并为单工具后，`stat` 不再能"单独保持无条件注册"（一个工具无法只注册一个 op）
    // ⇒ 整族统一受 `VFS_ENABLED` 门控；这是合并的**已知代价**，回退即拆回四件。
    // 回滚（CD06）/显式启用：`FEATURE_VFS_ENABLED=true`。
    cond(coreFeature('VFS_ENABLED'), byKey('createVfsFamilyTool')),

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
