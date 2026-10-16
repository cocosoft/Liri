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
import { FileConvertTool } from '../FileConvertTool/FileConvertTool';
import { GrepTool } from '../GrepTool/GrepTool';
import { GlobTool } from '../search/GlobTool';
import { WebFetchTool } from '../WebFetchTool/WebFetchTool';
import { WebSearchTool } from '../WebSearchTool/WebSearchTool';
// ── 代码理解（LSP / REPL / Notebook） ──
import { LSPToolAdapter } from '../adapters/LSPToolAdapter';
import { REPLToolAdapter } from '../adapters/REPLToolAdapter';
import { NotebookToolAdapter } from '../adapters/NotebookToolAdapter';
// ── 配置 / 任务 / 调度 ──
import { ConfigTool } from '../ConfigTool/ConfigTool';
import { TodoWriteTool } from '../TodoWriteTool/TodoWriteTool';
import { TaskStopTool } from '../TaskTool/TaskStopTool';
import {
  TaskCreateListTool,
  TaskUpdateStatusTool,
  TaskGetListTool,
} from '../TaskOrchestratorTools/TaskOrchestratorTools';
// P4b（2026-10-16）：`task_output` 原为影子工具（零 loader）⇒ 接线（见 P4a 评估 §2.2(1)）
import { TaskOutputTool } from '../TaskOutputTool/TaskOutputTool';
import { CronCreateTool } from '../ChronosTool/CronCreateTool';
import { CronDeleteTool } from '../ChronosTool/CronDeleteTool';
import { CronListTool } from '../ChronosTool/CronListTool';
import { CronStopTool } from '../ChronosTool/CronStopTool';
// ── Agent / Skill / 知识 ──
import { AgentTool } from '../AgentTool/AgentTool';
import { SkillTool } from '../SkillTool/SkillTool';
import { SkillListTool } from '../SkillTool/SkillListTool';
import { SkillViewTool } from '../SkillTool/SkillViewTool';
import { KnowledgeSaveTool } from '../KnowledgeSaveTool/KnowledgeSaveTool';
// ── 交互 / 会话 / 桌面 ──
import { AskUserQuestionTool } from '../AskUserQuestionTool/AskUserQuestionTool';
import { BriefTool } from '../BriefTool/BriefTool';
import { SaveConversationTool } from '../SaveConversationTool/SaveConversationTool';
import { SessionsTool } from '../SessionsTool/SessionsTool';
import { SessionsYieldTool } from '../SessionsYieldTool/SessionsYieldTool';
import { ClipboardTool } from '../ClipboardTool/ClipboardTool';
import { DocGenerateTool } from '../DocGenerateTool/DocGenerateTool';
import { MonitorTool } from '../MonitorTool/MonitorTool.js';
import { TraceRecordingTool } from '../TraceRecordingTool/TraceRecordingTool.js';
import { SleepTool } from '../SleepTool/SleepTool.js';
import { CodeRunnerTool } from '../CodeRunner/CodeRunnerTool.js';
import {
  createSleepForTool,
  createSleepUntilTool,
} from '../SelfWakeTool/SelfWakeTool';
import { createComputerUseTool } from '../ComputerUseTool/ComputerUseTool';
// ── 网络 / 浏览器 / 计划 ──
import { BrowserTool } from '../BrowserTool/BrowserTool';
import { BrowserVisionTool } from '../BrowserVisionTool/BrowserVisionTool';
import { PlanTool } from '../PlanTool/PlanTool';
import { ToolSearchTool } from '../ToolSearchTool/ToolSearchTool';
import { TungstenTool } from '../TungstenTool/TungstenTool';
// ── 通道 / 团队 ──
import { ChannelTool } from '../ChannelTool/ChannelTool';
import { BroadcastTool } from '../BroadcastTool/BroadcastTool';
import { SendMessageTool } from '../SendMessageTool/SendMessageTool';
import { TeamCreateTool } from '../TeamCreateTool/TeamCreateTool';
import { TeamDeleteTool } from '../TeamDeleteTool/TeamDeleteTool';
import { ListPeersTool } from '../ListPeersTool/ListPeersTool';
// ── 工作区 / 项目文件 / VFS ──
import { EnterWorktreeTool } from '../EnterWorktreeTool/EnterWorktreeTool';
import { ExitWorktreeTool } from '../ExitWorktreeTool/ExitWorktreeTool';
import { CreateProjectTool } from '../CreateProjectTool/CreateProjectTool';
import { ReadProjectFileTool } from '../ReadProjectFileTool/ReadProjectFileTool';
import { WriteProjectFileTool } from '../WriteProjectFileTool/WriteProjectFileTool';
import { ReadVfsTool } from '../ReadVfsTool/ReadVfsTool';
import { ListVfsTool } from '../ListVfsTool/ListVfsTool';
import { StatVfsTool } from '../StatVfsTool/StatVfsTool';
import { WriteVfsTool } from '../WriteVfsTool/WriteVfsTool';
// ── 媒体 ──
import { ImageTool } from '../ImageTool/ImageTool';
import { ImageAnalysisTool } from '../ImageAnalysisTool/ImageAnalysisTool';
import { ImageGenerateTool } from '../ImageGenerateTool/ImageGenerateTool';
import { ImageSvgTool } from '../ImageSvgTool/ImageSvgTool';
import { ImageDisplayTool } from '../ImageDisplayTool/ImageDisplayTool';
import { VideoTool } from '../VideoTool/VideoTool';
import { VideoAnalysisTool } from '../VideoAnalysisTool/VideoAnalysisTool';
import { VideoGenerateTool } from '../VideoGenerateTool/VideoGenerateTool';
import { VideoDisplayTool } from '../VideoDisplayTool/VideoDisplayTool';
import { AudioPlayTool } from '../AudioPlayTool/AudioPlayTool';
import { MusicTool } from '../MusicTool/MusicTool';
import { CanvasTool } from '../CanvasTool/CanvasTool';
// ── MCP（三方工具面） ──
import { MCPTool } from '../../mcp/MCPTool';
import { MCPResourceTool } from '../MCPResourceTool/MCPResourceTool';
// ── 门控 / 守卫 / KAIROS 委托 ──
import { isToolEnabled } from '../utils/ToolFeatureFlags';
import { guardToolCreation } from './toolCreationGuard.js';
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
  // ── Agent / Skill / 知识 ──
  createAgentTool: () => new AgentTool(),
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
  createCanvasTool: () => new CanvasTool(),
  // ── MCP ──
  /** 原实现直返模块绑定（**无 `new`**）—— 逐字保留 */
  createMCPTool: () => MCPTool,
  createMCPResourceTool: () => new MCPResourceTool(),
  // ── KAIROS 委托（实现见 `kairosNotificationFactories`） ──
  createPushNotificationTool: buildPushNotificationTool,
  createSubscribePRTool: buildSubscribePRTool,
} as const satisfies Record<string, () => Tool | null>;

/** 注册表键（编译期字面量联合；拼错 ⇒ `typecheck` 失败） */
export type BuiltinToolFactoryKey = keyof typeof BUILTIN_TOOL_FACTORIES;
