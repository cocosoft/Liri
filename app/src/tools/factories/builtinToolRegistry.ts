// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * builtinToolRegistry — 内置工具的**注册表驱动构造表**（G18，2026-10-11）
 *
 * 背景：`ToolFactory` 原名 ~80 个 `createXxxTool()` 方法（合计 ~700 行）承载"每个工具一个构造入口"，
 * 属**广度型**上帝对象。本表把它收敛为**一张 name → thunk 表**：
 * - **唯一来源**：每个键对应一个构造 thunk，其行为与迁移前的方法体**逐字等价**
 *   （含 `X.create()` 形态、`MCPTool` 直返、`PlanTool` 转型、`guardToolCreation` 守卫、
 *   `isToolEnabled` 门控、以及 `kairosNotificationFactories` 的委托）；
 * - **编译期安全**：`as const` ⇒ `BuiltinToolFactoryKey` 为字面量联合，调用方**拼错键即编译失败**；
 * - `ToolFactory.create(key)` 仅作**转发**（保留 `ToolFactory` 实例 API 与 loader 引用形态）。
 *
 * 键名沿用原方法名（`createBashTool` 等）⇒ 迁移零改名、零语义变化（纯重构）。
 */

import type { Tool } from '../types/Tool';
import type { ToolProgressData } from '../types/ToolProgress';

// ── 基础 / 文件 / 搜索 ──
import { BashTool } from '../bash/BashTool';
import { PowerShellTool } from '../PowerShellTool/PowerShellTool';
import { FileReadTool } from '../FileReadTool/FileReadTool';
import { FileWriteTool } from '../FileWriteTool/FileWriteTool';
import { FileEditTool } from '../FileEditTool/FileEditTool';
import { GrepTool } from '../GrepTool/GrepTool';
import { GlobTool } from '../search/GlobTool';
// J 档（2026-11-23）：Web/检索域已下沉 `@openliri/tool-web`
import { WebFetchTool } from '@openliri/tool-web';
import { WebSearchTool } from '@openliri/tool-web';
// ── 代码理解（LSP / REPL / Notebook） ──
// D 档（2026-11-22）：代码理解域已下沉 `@openliri/tool-code`
import {
  LSPToolAdapter,
  REPLToolAdapter,
  NotebookToolAdapter,
} from '@openliri/tool-code';
// ── 配置 / 任务 / 调度 ──
// F 档（2026-11-22）：任务与调度域已下沉 `@openliri/tool-task`
import {
  ConfigTool,
  TaskStopTool,
  TaskCreateListTool,
  TaskUpdateStatusTool,
  TaskGetListTool,
  TaskOutputTool,
  CronCreateTool,
  CronDeleteTool,
  CronListTool,
  CronStopTool,
  KanbanTool,
  MonitorTool,
  TraceRecordingTool,
  SleepTool,
  createSleepForTool,
  createSleepUntilTool,
  TimeTool,
  PlanTool,
} from '@openliri/tool-task';
import { TodoWriteTool } from '../TodoWriteTool/TodoWriteTool';
// ── Agent / Skill / 知识 ──
// H 档（2026-11-23）：Agent/Skill/Knowledge/Memory 域已下沉 `@openliri/tool-agent`
import {
  AgentTool,
  // Q-18（2026-10-23）：`agents_list` 由影子工具接线（只读活跃代理投影，与 /v1/agents/control 同源）
  AgentsListTool,
  SkillTool,
  SkillListTool,
  SkillViewTool,
  KnowledgeSaveTool,
} from '@openliri/tool-agent';
// ── 交互 / 会话 / 桌面 ──
import { AskUserQuestionTool } from '../AskUserQuestionTool/AskUserQuestionTool';
import { BriefTool } from '../BriefTool/BriefTool';
import { SaveConversationTool } from '../SaveConversationTool/SaveConversationTool';
// E 档（2026-11-22）：会话与协作域已下沉 `@openliri/tool-session`
import {
  SessionsTool,
  SessionsYieldTool,
  ChannelTool,
  BroadcastTool,
  SendMessageTool,
  TeamCreateTool,
  TeamDeleteTool,
  ListPeersTool,
  TungstenTool,
} from '@openliri/tool-session';
import { ClipboardTool } from '../ClipboardTool/ClipboardTool';
import {
  DocGenerateTool,
  createPDFTool,
  FileConvertTool,
} from '@openliri/tool-office';
import { CodeRunnerTool } from '../CodeRunner/CodeRunnerTool.js';
import { createComputerUseTool } from '@openliri/tool-desktop';
// ── 网络 / 浏览器 / 计划 ──
import { BrowserTool, BrowserVisionTool } from '@openliri/tool-browser';
import { ToolSearchTool } from '../ToolSearchTool/ToolSearchTool';
// ── 通道 / 团队 ──
// （已并入上方 `@openliri/tool-session` 导入）
// ── 工作区 / 项目文件 / VFS ──
// G 档（2026-11-23）：工作区 / VFS 域已下沉 `@openliri/tool-workspace`
import {
  EnterWorktreeTool,
  ExitWorktreeTool,
  CreateProjectTool,
  ReadProjectFileTool,
  WriteProjectFileTool,
  ReadVfsTool,
  ListVfsTool,
  StatVfsTool,
  WriteVfsTool,
} from '@openliri/tool-workspace';
// ── 媒体 ──
// A 档（2026-11-22）：模型面媒体编辑 / 分析工具已下沉 `@openliri/tool-media`
import {
  ImageTool,
  ImageSvgTool,
  ImageDisplayTool,
  ImageGenerateTool,
  ImageAnalysisTool,
  VideoTool,
  VideoAnalysisTool,
  VideoDisplayTool,
  VideoGenerateTool,
  MusicTool,
  AudioPlayTool,
  CanvasTool,
  createTTSTool,
} from '@openliri/tool-media';
// ── MCP（三方工具面） ──
import { MCPTool } from '@openliri/service/mcp/MCPTool';
// I 档（2026-11-23）：MCP 资源/授权工具已下沉 `@openliri/tool-mcp`
// Q-18（2026-10-23）：`mcp_auth` 由影子工具接线（经 mcpAuthManager；受 MCP_OAUTH 门控）
import { MCPResourceTool, McpAuthTool } from '@openliri/tool-mcp';
// ── 门控 / 守卫 / KAIROS 委托 ──
import { isToolEnabled } from '../utils/ToolFeatureFlags';
import { guardToolCreation } from './toolCreationGuard.js';
// ── P1（2026-10-30）：同资源族合并工具（skill / vfs / worktree / sleep / cron / task_list 均已下沉对应 tool-* 包） ──
import { createSkillFamilyTool } from '@openliri/tool-agent';
import {
  createVfsFamilyTool,
  createWorktreeFamilyTool,
} from '@openliri/tool-workspace';
import {
  createSleepFamilyTool,
  createCronFamilyTool,
  createTaskListFamilyTool,
} from '@openliri/tool-task';
import {
  createPushNotificationTool as buildPushNotificationTool,
  createSubscribePRTool as buildSubscribePRTool,
} from './kairosNotificationFactories.js';

/**
 * 内置工具构造表（**唯一来源**）。
 *
 * ⚠️ 新增内置工具 = 在此加一条 + 在 `ToolManagerUtils.buildBuiltinToolLoaders` 注册；
 * 键名（`BuiltinToolFactoryKey`）为编译期字面量联合 ⇒ 拼错即 `typecheck` 失败。
 */
export const BUILTIN_TOOL_FACTORIES = {
  // ── 基础 / 文件 / 搜索 ──
  createBashTool: () => new BashTool(),
  createPowerShellTool: () => new PowerShellTool(),
  createFileReadTool: () => new FileReadTool(),
  createFileWriteTool: () => new FileWriteTool(),
  createFileEditTool: () => new FileEditTool(),
  createFileConvertTool: () => new FileConvertTool(),
  createGrepTool: () => new GrepTool(),
  createGlobTool: () => new GlobTool(),
  createWebFetchTool: () => new WebFetchTool(),
  createWebSearchTool: () => new WebSearchTool(),
  // ── 代码理解 ──
  createLSPTool: () => new LSPToolAdapter(),
  createREPLTool: () => new REPLToolAdapter(),
  createNotebookTool: () => new NotebookToolAdapter(),
  /** 兼容旧接口，实际返回 NotebookToolAdapter（保留原语义） */
  createNotebookEditTool: () => new NotebookToolAdapter(),
  // ── 配置 / 任务 / 调度 ──
  createConfigTool: () => new ConfigTool(),
  createTodoWriteTool: () => new TodoWriteTool(),
  createTaskStopTool: () => new TaskStopTool(),
  createTaskCreateListTool: () => new TaskCreateListTool(),
  createTaskUpdateStatusTool: () => new TaskUpdateStatusTool(),
  createTaskGetListTool: () => new TaskGetListTool(),
  createTaskOutputTool: () => new TaskOutputTool(),
  createCronCreateTool: () => CronCreateTool.create(),
  createCronDeleteTool: () => CronDeleteTool.create(),
  createCronListTool: () => CronListTool.create(),
  createCronStopTool: () => CronStopTool.create(),
  createKanbanTool: () => new KanbanTool(),
  // ── P1（2026-10-30）：同资源族合并入口（旧名保留为 alias，不再单独注册） ──
  createVfsFamilyTool: () => createVfsFamilyTool(),
  createSleepFamilyTool: () => createSleepFamilyTool(),
  createSkillFamilyTool: () => createSkillFamilyTool(),
  createCronFamilyTool: () => createCronFamilyTool(),
  createWorktreeFamilyTool: () => createWorktreeFamilyTool(),
  createTaskListFamilyTool: () => createTaskListFamilyTool(),
  // ── Agent / Skill / 知识 ──
  createAgentTool: () => new AgentTool(),
  createAgentsListTool: () => new AgentsListTool(),
  createSkillTool: () => new SkillTool(),
  createSkillListTool: () => new SkillListTool(),
  createSkillViewTool: () => new SkillViewTool(),
  createKnowledgeSaveTool: () => new KnowledgeSaveTool(),
  // ── 交互 / 会话 / 桌面 ──
  createAskUserQuestionTool: () => new AskUserQuestionTool(),
  createBriefTool: () => new BriefTool(),
  createSaveConversationTool: () => new SaveConversationTool(),
  createSessionsTool: () => new SessionsTool(),
  createSessionsYieldTool: () => new SessionsYieldTool(),
  createClipboardTool: () => new ClipboardTool(),
  createDocGenerateTool: () => new DocGenerateTool(),
  createComputerUseTool: () => createComputerUseTool(),
  // ── 通用（带守卫 / 门控，逐字保留原语义） ──
  createSleepTool: () =>
    guardToolCreation('create_sleep_tool', () => new SleepTool()),
  createCodeRunnerTool: () =>
    guardToolCreation('create_code_runner_tool', () => new CodeRunnerTool()),
  createMonitorTool: () =>
    guardToolCreation('create_monitor_tool', () => new MonitorTool()),
  createTraceRecordingTool: () =>
    guardToolCreation(
      'create_trace_recording_tool',
      () => new TraceRecordingTool()
    ),
  createSleepForTool: () => createSleepForTool(),
  createSleepUntilTool: () => createSleepUntilTool(),
  createSendMessageTool: () =>
    isToolEnabled('ENABLE_SEND_MESSAGE')
      ? guardToolCreation(
          'create_send_message_tool',
          () => new SendMessageTool()
        )
      : null,
  createTeamCreateTool: () =>
    isToolEnabled('ENABLE_TEAM_CREATE')
      ? guardToolCreation('create_team_create_tool', () => new TeamCreateTool())
      : null,
  createTeamDeleteTool: () =>
    isToolEnabled('ENABLE_TEAM_DELETE')
      ? guardToolCreation('create_team_delete_tool', () => new TeamDeleteTool())
      : null,
  // ── 网络 / 浏览器 / 计划 ──
  createBrowserTool: () => new BrowserTool(),
  createBrowserVisionTool: () => new BrowserVisionTool(),
  createPlanTool: () =>
    new PlanTool() as unknown as Tool<unknown, unknown, ToolProgressData>,
  // 2026-10-16：`createProposePlanTool` 已随 `propose_plan` 下线移除（合并到 `ask_user_question` 审批入口）
  // P4b（2026-10-16，P4a 评估 §2.2(3)）：`pdf` 接线（复用其文件内**早已导出**的
  // `createPDFTool()` —— 工厂存在但从未登记，是"实现了没接线"的直接证据）
  createPDFTool,
  createToolSearchTool: () => new ToolSearchTool(),
  createTungstenTool: () => new TungstenTool(),
  // ── 通道 / 团队 ──
  createChannelManagerTool: () => new ChannelTool(),
  createBroadcastTool: () => new BroadcastTool(),
  createListPeersTool: () => new ListPeersTool(),
  // ── 工作区 / 项目文件 / VFS ──
  createEnterWorktreeTool: () => new EnterWorktreeTool(),
  createExitWorktreeTool: () => new ExitWorktreeTool(),
  createProjectTool: () => CreateProjectTool.create(),
  createReadProjectFileTool: () => ReadProjectFileTool.create(),
  createWriteProjectFileTool: () => WriteProjectFileTool.create(),
  createReadVfsTool: () => ReadVfsTool.create(),
  createListVfsTool: () => ListVfsTool.create(),
  createStatVfsTool: () => StatVfsTool.create(),
  createWriteVfsTool: () => WriteVfsTool.create(),
  // ── 媒体 ──
  createImageTool: () => new ImageTool(),
  createImageAnalysisTool: () => new ImageAnalysisTool(),
  createImageGenerateTool: () => new ImageGenerateTool(),
  createImageSvgTool: () => new ImageSvgTool(),
  createImageDisplayTool: () => new ImageDisplayTool(),
  createVideoTool: () => new VideoTool(),
  createVideoAnalysisTool: () => new VideoAnalysisTool(),
  createVideoGenerateTool: () => new VideoGenerateTool(),
  createVideoDisplayTool: () => new VideoDisplayTool(),
  createAudioPlayTool: () => new AudioPlayTool(),
  createMusicTool: () => new MusicTool(),
  createTTSTool: () => createTTSTool(),
  createCanvasTool: () => new CanvasTool(),
  // ── MCP ──
  /** 原实现直返模块绑定（**无 `new`**）—— 逐字保留 */
  createMCPTool: () => MCPTool,
  createMCPResourceTool: () => new MCPResourceTool(),
  createMcpAuthTool: () => new McpAuthTool(),
  // ── KAIROS 委托（实现见 `kairosNotificationFactories`） ──
  createPushNotificationTool: buildPushNotificationTool,
  createSubscribePRTool: buildSubscribePRTool,
} as const satisfies Record<string, () => Tool | null>;

/** 注册表键（编译期字面量联合；拼错 ⇒ `typecheck` 失败） */
export type BuiltinToolFactoryKey = keyof typeof BUILTIN_TOOL_FACTORIES;
