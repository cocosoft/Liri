/**
 * 工具UI组件注册表
 *
 * 统一管理各工具的 UI 渲染函数映射。
 * 工具执行后通过此注册表自动查找对应的 UI 组件进行渲染。
 * 支持两级查找：先查注册表，再降级到工具实例的原生渲染方法。
 */

import type React from 'react';
import { handleError } from '@modules/error';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('components:ui:ToolUIRegistry');

export interface ToolUIRenderer {
  renderToolUseMessage?: (
    input: unknown,
    options: { verbose: boolean }
  ) => React.ReactNode;

  renderToolResultMessage?: (
    output: unknown,
    progressMessages: unknown[],
    options: { verbose: boolean }
  ) => React.ReactNode;

  renderToolUseErrorMessage?: (
    error: string,
    options: { verbose: boolean }
  ) => React.ReactNode;

  renderToolUseProgressMessage?: (data: unknown) => React.ReactNode;

  getToolUseSummary?: (input: unknown) => string | null;
}

const registry = new Map<string, ToolUIRenderer>();

export function registerToolUI(
  toolName: string,
  renderer: ToolUIRenderer
): void {
  registry.set(toolName.toLowerCase(), renderer);
}

/**
 * 获取注册的 UI 渲染器
 * 优先查找注册表，如果未找到则返回 undefined
 */
export function getToolUI(toolName: string): ToolUIRenderer | undefined {
  return registry.get(toolName.toLowerCase());
}

/**
 * 获取工具 UI 渲染器（含工具原生渲染降级）
 * 优先查找注册表，如果未找到则尝试从工具实例构建渲染器
 *
 * @param toolName 工具名称
 * @param tool 工具实例（可选，用于降级查找原生渲染方法）
 * @returns UI 渲染器，如果均未找到则返回 undefined
 */
export function getToolUIWithFallback(
  toolName: string,
  tool?: {
    renderToolUseMessage?: Function;
    renderToolResultMessage?: Function;
    renderToolUseErrorMessage?: Function;
    renderToolUseProgressMessage?: Function;
    getToolUseSummary?: Function;
  }
): ToolUIRenderer | undefined {
  const registered = registry.get(toolName.toLowerCase());
  if (registered) return registered;

  if (!tool) return undefined;

  const fallback: ToolUIRenderer = {};
  if (typeof tool.renderToolUseMessage === 'function') {
    fallback.renderToolUseMessage =
      tool.renderToolUseMessage as ToolUIRenderer['renderToolUseMessage'];
  }
  if (typeof tool.renderToolResultMessage === 'function') {
    fallback.renderToolResultMessage =
      tool.renderToolResultMessage as ToolUIRenderer['renderToolResultMessage'];
  }
  if (typeof tool.renderToolUseErrorMessage === 'function') {
    fallback.renderToolUseErrorMessage =
      tool.renderToolUseErrorMessage as ToolUIRenderer['renderToolUseErrorMessage'];
  }
  if (typeof tool.renderToolUseProgressMessage === 'function') {
    fallback.renderToolUseProgressMessage =
      tool.renderToolUseProgressMessage as ToolUIRenderer['renderToolUseProgressMessage'];
  }
  if (typeof tool.getToolUseSummary === 'function') {
    fallback.getToolUseSummary =
      tool.getToolUseSummary as ToolUIRenderer['getToolUseSummary'];
  }

  return Object.keys(fallback).length > 0 ? fallback : undefined;
}

export function hasToolUI(toolName: string): boolean {
  return registry.has(toolName.toLowerCase());
}

export function getRegisteredToolNames(): string[] {
  return Array.from(registry.keys());
}

/**
 * 默认工具 UI 模块台账（模块路径 → 应注册的工具名）。
 *
 * 2026-10-19（U-03）：原实现是 46 段 `require('./toolUIs/…')` 的 `try/catch`，实测
 * **`require()` 无法加载 async UI 模块**（Bun 报 `require() async module is unsupported`）⇒
 * 全部落入 catch、注册表永远为空。现改为**数据驱动的 `await import()`**：
 * - 每个模块只写一次路径，避免 46 段重复样板；
 * - 注册键必须是**真实工具名**（见 `toolNameConstants.ts` / `TOOL_NAMES`）；
 * - 初始化幂等（同一 Promise 复用），失败只记日志、不阻断调用方。
 */
interface ToolUIModuleEntry {
  /** 相对本文件的模块说明符（动态导入，运行时解析） */
  module: string;
  /** 该模块负责渲染的工具名（必须是真实工具名） */
  names: readonly string[];
}

const DEFAULT_TOOL_UI_MODULES: readonly ToolUIModuleEntry[] = [
  // `agenttool` 从不是工具名 ⇒ 只注册 `agent`
  { module: './toolUIs/AgentTool/UI', names: ['agent'] },
  { module: './toolUIs/FileReadTool/UI', names: ['file_read'] },
  { module: './toolUIs/FileWriteTool/UI', names: ['file_write'] },
  { module: './toolUIs/FileEditTool/UI', names: ['file_edit'] },
  { module: './toolUIs/bash/UI', names: ['bash'] },
  { module: './toolUIs/GrepTool/UI', names: ['grep'] },
  { module: './toolUIs/GlobTool/UI', names: ['glob'] },
  { module: './toolUIs/WebFetchTool/UI', names: ['web_fetch'] },
  { module: './toolUIs/WebSearchTool/UI', names: ['web_search'] },
  { module: './toolUIs/SkillTool/UI', names: ['skill'] },
  // 2026-10-19（U-03）：`enter_plan_mode` / `exit_plan_mode`（`PlanTool/UI`）均非真实工具名 ⇒ 不注册
  { module: './toolUIs/BriefTool/UI', names: ['brief'] },
  { module: './toolUIs/LSPTool/UI', names: ['lsp'] },
  { module: './toolUIs/ConfigTool/UI', names: ['config'] },
  {
    module: './toolUIs/ChronosTool/UI',
    names: ['cron_create', 'cron_delete', 'cron_list'],
  },
  { module: './toolUIs/PowerShellTool/UI', names: ['powershell'] },
  { module: './toolUIs/TeamCreateTool/UI', names: ['team_create'] },
  { module: './toolUIs/TeamDeleteTool/UI', names: ['team_delete'] },
  { module: './toolUIs/SendMessageTool/UI', names: ['send_message'] },
  // 真实工具名是 `mcp_resource`（`mcp` 从不是工具名）
  { module: './toolUIs/MCPResourceTool/UI', names: ['mcp_resource'] },
  { module: './toolUIs/EnterWorktreeTool/UI', names: ['enter_worktree'] },
  { module: './toolUIs/ExitWorktreeTool/UI', names: ['exit_worktree'] },
  { module: './toolUIs/ListPeersTool/UI', names: ['list_peers'] },
  { module: './toolUIs/ClipboardTool/UI', names: ['clipboard'] },
  { module: './toolUIs/ImageTool/UI', names: ['image'] },
  // 2026-10-23（Q-18）：`thinking` 影子工具已摘除声明，其专用 UI 映射与
  // `toolUIs/ThinkingTool/UI` 文件已随第 2 步一并删除。
  { module: './toolUIs/AskUserQuestionTool/UI', names: ['ask_user_question'] },
  { module: './toolUIs/BrowserTool/UI', names: ['browser'] },
  { module: './toolUIs/CodeAnalysisTool/UI', names: ['code_analysis'] },
  { module: './toolUIs/MonitorTool/UI', names: ['monitor'] },
  { module: './toolUIs/PushNotificationTool/UI', names: ['push_notification'] },
  { module: './toolUIs/SleepTool/UI', names: ['sleep'] },
  { module: './toolUIs/SubscribePRTool/UI', names: ['subscribe_pr'] },
  { module: './toolUIs/TaskOutputTool/UI', names: ['task_output'] },
  { module: './toolUIs/TaskStopTool/UI', names: ['task_stop'] },
  // 2026-10-19（U-03）：`time`（`TimeTool/UI`）对应的 `TimeTool` 未接线 ⇒ 不注册
  { module: './toolUIs/TodoWriteTool/UI', names: ['todo_write'] },
  { module: './toolUIs/ToolSearchTool/UI', names: ['tool_search'] },
  { module: './toolUIs/TungstenTool/UI', names: ['tungsten'] },
  { module: './toolUIs/VoiceInputTool/UI', names: ['voice_input'] },
  // 2026-10-23（Q-18 尾项，CD05 第 1 步）：`voice_output` 已被判定为 `tts` 的**子集死代码**
  // （能力已由 `tts` 接线覆盖）⇒ 先摘登记、实现文件保留观察，观察期后再删实现。
  { module: './toolUIs/KnowledgeSearchTool/UI', names: ['knowledge_search'] },
  { module: './toolUIs/KnowledgeWriteTool/UI', names: ['knowledge_write'] },
  { module: './toolUIs/KnowledgeDeleteTool/UI', names: ['knowledge_delete'] },
  { module: './toolUIs/KnowledgeImportTool/UI', names: ['knowledge_import'] },
  { module: './toolUIs/KnowledgeExportTool/UI', names: ['knowledge_export'] },
  {
    module: './toolUIs/KnowledgeSnapshotsTool/UI',
    names: ['knowledge_snapshots'],
  },
  {
    module: './toolUIs/KnowledgeRestoreTool/UI',
    names: ['knowledge_restore'],
  },
];

let defaultRegistryInit: Promise<void> | null = null;

/**
 * 初始化默认工具 UI 注册表（幂等）。
 *
 * 逐个 `await import()` 各工具的 UI 模块；某模块缺失/加载失败只记日志并跳过
 * —— 这是可选的渲染优化，不影响核心功能。
 */
export function initDefaultToolUIRegistry(): Promise<void> {
  if (!defaultRegistryInit) {
    defaultRegistryInit = loadDefaultToolUIRegistry();
  }
  return defaultRegistryInit;
}

async function loadDefaultToolUIRegistry(): Promise<void> {
  for (const entry of DEFAULT_TOOL_UI_MODULES) {
    try {
      const renderer = (await import(entry.module)) as ToolUIRenderer;
      for (const name of entry.names) registerToolUI(name, renderer);
    } catch (err) {
      await handleError(err, {
        module: 'components:ui',
        action: `loadToolUI(${entry.module})`,
      });
    }
  }
}

/** 仅供测试重置（避免幂等 Promise 在用例间串味） */
export function resetDefaultToolUIRegistryForTests(): void {
  registry.clear();
  defaultRegistryInit = null;
}
