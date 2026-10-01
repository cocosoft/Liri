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
 * 初始化默认工具 UI 注册表。
 * 逐个尝试加载各工具的 UI 模块（require），
 * 若某工具无 UI 模块则静默跳过——这是可选的优化加载模式，不影响核心功能。
 */
export function initDefaultToolUIRegistry(): void {
  try {
    const agentUI = require('./toolUIs/AgentTool/UI');
    registerToolUI('agent', agentUI);
    registerToolUI('agenttool', agentUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'loadAgentUI' });
  } // @ignore-catch: optional UI module

  try {
    const fileReadUI = require('./toolUIs/FileReadTool/UI');
    registerToolUI('file_read', fileReadUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }
  try {
    const fileWriteUI = require('./toolUIs/FileWriteTool/UI');
    registerToolUI('file_write', fileWriteUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }
  try {
    const fileEditUI = require('./toolUIs/FileEditTool/UI');
    registerToolUI('file_edit', fileEditUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    // G1（2026-09-26）：原指向**无静态引用的大写副本** `tools/BashTool/UI`；因该副本的导出
    // 反而更全（5 个，见 `tools/bash/UI.tsx` 头注释），已把其内容**合并**进活跃目录并删副本。
    const bashUI = require('./toolUIs/bash/UI');
    registerToolUI('bash', bashUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const grepUI = require('./toolUIs/GrepTool/UI');
    registerToolUI('grep', grepUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const globUI = require('./toolUIs/GlobTool/UI');
    registerToolUI('glob', globUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const webFetchUI = require('./toolUIs/WebFetchTool/UI');
    registerToolUI('web_fetch', webFetchUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const webSearchUI = require('./toolUIs/WebSearchTool/UI');
    registerToolUI('web_search', webSearchUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const skillUI = require('./toolUIs/SkillTool/UI');
    registerToolUI('skill', skillUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const planUI = require('./toolUIs/PlanTool/UI');
    registerToolUI('enter_plan_mode', planUI);
    registerToolUI('exit_plan_mode', planUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  // ⚠️ 沿革（2026-09-29，另案 ②）：原此处注册 `task` / `task_update` / `task_get` / `task_list`
  // 四条 UI（原取自 `tools/TaskTool/UI`）—— 这 4 个名字**均非真实工具名**：
  // 活的任务工具是 `create_task_list` / `update_task_status` / `get_task_list` / `task_stop`
  // （见 `GET /v1/tools`），其中 `task_update` / `task_get` / `task_list` 的实现类已随 D-15 删除，
  // `task` 从不是工具名 ⇒ 属"注册了、工具永不产生"的错配，故整块删除。
  // 连带：`tools/TaskTool/UI.tsx` 因此失去唯一引用（同批删除）。

  try {
    const briefUI = require('./toolUIs/BriefTool/UI');
    registerToolUI('brief', briefUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const lspUI = require('./toolUIs/LSPTool/UI');
    registerToolUI('lsp', lspUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const configUI = require('./toolUIs/ConfigTool/UI');
    registerToolUI('config', configUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const chronosUI = require('./toolUIs/ChronosTool/UI');
    registerToolUI('cron_create', chronosUI);
    registerToolUI('cron_delete', chronosUI);
    registerToolUI('cron_list', chronosUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const pwshUI = require('./toolUIs/PowerShellTool/UI');
    registerToolUI('powershell', pwshUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const teamCreateUI = require('./toolUIs/TeamCreateTool/UI');
    registerToolUI('team_create', teamCreateUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const teamDeleteUI = require('./toolUIs/TeamDeleteTool/UI');
    registerToolUI('team_delete', teamDeleteUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const sendMsgUI = require('./toolUIs/SendMessageTool/UI');
    registerToolUI('send_message', sendMsgUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const mcpUI = require('./toolUIs/MCPResourceTool/UI');
    registerToolUI('mcp', mcpUI);
    registerToolUI('list_mcp_resources', mcpUI);
    registerToolUI('read_mcp_resource', mcpUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const worktreeEnterUI = require('./toolUIs/EnterWorktreeTool/UI');
    registerToolUI('enter_worktree', worktreeEnterUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const worktreeExitUI = require('./toolUIs/ExitWorktreeTool/UI');
    registerToolUI('exit_worktree', worktreeExitUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const peersUI = require('./toolUIs/ListPeersTool/UI');
    registerToolUI('list_peers', peersUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const clipboardUI = require('./toolUIs/ClipboardTool/UI');
    registerToolUI('clipboard', clipboardUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const imageUI = require('./toolUIs/ImageTool/UI');
    registerToolUI('image', imageUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const thinkingUI = require('./toolUIs/ThinkingTool/UI');
    registerToolUI('thinking', thinkingUI);
    registerToolUI('think', thinkingUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const askUserUI = require('./toolUIs/AskUserQuestionTool/UI');
    registerToolUI('ask_user_question', askUserUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const browserUI = require('./toolUIs/BrowserTool/UI');
    registerToolUI('browser', browserUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const codeAnalysisUI = require('./toolUIs/CodeAnalysisTool/UI');
    registerToolUI('code_analysis', codeAnalysisUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const monitorUI = require('./toolUIs/MonitorTool/UI');
    registerToolUI('monitor', monitorUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const pushNotifUI = require('./toolUIs/PushNotificationTool/UI');
    registerToolUI('push_notification', pushNotifUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const sleepUI = require('./toolUIs/SleepTool/UI');
    registerToolUI('sleep', sleepUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const subscribePRUI = require('./toolUIs/SubscribePRTool/UI');
    registerToolUI('subscribe_pr', subscribePRUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const taskOutputUI = require('./toolUIs/TaskOutputTool/UI');
    registerToolUI('task_output', taskOutputUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const taskStopUI = require('./toolUIs/TaskStopTool/UI');
    registerToolUI('task_stop', taskStopUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const timeUI = require('./toolUIs/TimeTool/UI');
    registerToolUI('time', timeUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const todoWriteUI = require('./toolUIs/TodoWriteTool/UI');
    registerToolUI('todo_write', todoWriteUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const toolSearchUI = require('./toolUIs/ToolSearchTool/UI');
    registerToolUI('tool_search', toolSearchUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const tungstenUI = require('./toolUIs/TungstenTool/UI');
    registerToolUI('tungsten', tungstenUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const voiceInputUI = require('./toolUIs/VoiceInputTool/UI');
    registerToolUI('voice_input', voiceInputUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const voiceOutputUI = require('./toolUIs/VoiceOutputTool/UI');
    registerToolUI('voice_output', voiceOutputUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  // Knowledge tools
  try {
    const knowledgeSearchUI = require('./toolUIs/KnowledgeSearchTool/UI');
    registerToolUI('knowledge_search', knowledgeSearchUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }
  try {
    const knowledgeWriteUI = require('./toolUIs/KnowledgeWriteTool/UI');
    registerToolUI('knowledge_write', knowledgeWriteUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }
  try {
    const knowledgeDeleteUI = require('./toolUIs/KnowledgeDeleteTool/UI');
    registerToolUI('knowledge_delete', knowledgeDeleteUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }
  try {
    const knowledgeImportUI = require('./toolUIs/KnowledgeImportTool/UI');
    registerToolUI('knowledge_import', knowledgeImportUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }
  try {
    const knowledgeExportUI = require('./toolUIs/KnowledgeExportTool/UI');
    registerToolUI('knowledge_export', knowledgeExportUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }
  try {
    const knowledgeSnapshotsUI = require('./toolUIs/KnowledgeSnapshotsTool/UI');
    registerToolUI('knowledge_snapshots', knowledgeSnapshotsUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }
  try {
    const knowledgeRestoreUI = require('./toolUIs/KnowledgeRestoreTool/UI');
    registerToolUI('knowledge_restore', knowledgeRestoreUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }
}
