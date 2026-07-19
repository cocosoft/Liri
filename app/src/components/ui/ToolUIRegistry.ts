/**
 * 工具UI组件注册表
 *
 * 统一管理各工具的 UI 渲染函数映射。
 * 工具执行后通过此注册表自动查找对应的 UI 组件进行渲染。
 * 支持两级查找：先查注册表，再降级到工具实例的原生渲染方法。
 */

import type React from 'react';
import { handleError } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'components:ui:ToolUIRegistry',
  level: LogLevel.INFO,
});

export interface ToolUIRenderer {
  renderToolUseMessage?: (
    input: any,
    options: { verbose: boolean }
  ) => React.ReactNode;

  renderToolResultMessage?: (
    output: any,
    progressMessages: any[],
    options: { verbose: boolean }
  ) => React.ReactNode;

  renderToolUseErrorMessage?: (
    error: string,
    options: { verbose: boolean }
  ) => React.ReactNode;

  renderToolUseProgressMessage?: (data: any) => React.ReactNode;

  getToolUseSummary?: (input: any) => string | null;
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
    const agentUI = require('../../tools/AgentTool/UI');
    registerToolUI('agent', agentUI);
    registerToolUI('agenttool', agentUI);
  } catch (err) {
    logger.debug('Operation skipped', {
      error: err instanceof Error ? err.message : String(err),
    });
  } // @ignore-catch: optional UI module

  try {
    const fileReadUI = require('../../tools/FileReadTool/UI');
    registerToolUI('file_read', fileReadUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }
  try {
    const fileWriteUI = require('../../tools/FileWriteTool/UI');
    registerToolUI('file_write', fileWriteUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }
  try {
    const fileEditUI = require('../../tools/FileEditTool/UI');
    registerToolUI('file_edit', fileEditUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const bashUI = require('../../tools/BashTool/UI');
    registerToolUI('bash', bashUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const grepUI = require('../../tools/GrepTool/UI');
    registerToolUI('grep', grepUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const globUI = require('../../tools/GlobTool/UI');
    registerToolUI('glob', globUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const webFetchUI = require('../../tools/WebFetchTool/UI');
    registerToolUI('web_fetch', webFetchUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const webSearchUI = require('../../tools/WebSearchTool/UI');
    registerToolUI('web_search', webSearchUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const skillUI = require('../../tools/SkillTool/UI');
    registerToolUI('skill', skillUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const planUI = require('../../tools/PlanTool/UI');
    registerToolUI('enter_plan_mode', planUI);
    registerToolUI('exit_plan_mode', planUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const taskUI = require('../../tools/TaskTool/UI');
    registerToolUI('task', taskUI);
    registerToolUI('task_update', taskUI);
    registerToolUI('task_get', taskUI);
    registerToolUI('task_list', taskUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const briefUI = require('../../tools/BriefTool/UI');
    registerToolUI('brief', briefUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const lspUI = require('../../tools/LSPTool/UI');
    registerToolUI('lsp', lspUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const configUI = require('../../tools/ConfigTool/UI');
    registerToolUI('config', configUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const chronosUI = require('../../tools/ChronosTool/UI');
    registerToolUI('cron_create', chronosUI);
    registerToolUI('cron_delete', chronosUI);
    registerToolUI('cron_list', chronosUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const pwshUI = require('../../tools/PowerShellTool/UI');
    registerToolUI('powershell', pwshUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const teamCreateUI = require('../../tools/TeamCreateTool/UI');
    registerToolUI('team_create', teamCreateUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const teamDeleteUI = require('../../tools/TeamDeleteTool/UI');
    registerToolUI('team_delete', teamDeleteUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const sendMsgUI = require('../../tools/SendMessageTool/UI');
    registerToolUI('send_message', sendMsgUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const mcpUI = require('../../tools/MCPResourceTool/UI');
    registerToolUI('mcp', mcpUI);
    registerToolUI('list_mcp_resources', mcpUI);
    registerToolUI('read_mcp_resource', mcpUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const worktreeEnterUI = require('../../tools/EnterWorktreeTool/UI');
    registerToolUI('enter_worktree', worktreeEnterUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const worktreeExitUI = require('../../tools/ExitWorktreeTool/UI');
    registerToolUI('exit_worktree', worktreeExitUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const peersUI = require('../../tools/ListPeersTool/UI');
    registerToolUI('list_peers', peersUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const clipboardUI = require('../../tools/ClipboardTool/UI');
    registerToolUI('clipboard', clipboardUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const imageUI = require('../../tools/ImageTool/UI');
    registerToolUI('image', imageUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const thinkingUI = require('../../tools/ThinkingTool/UI');
    registerToolUI('thinking', thinkingUI);
    registerToolUI('think', thinkingUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const askUserUI = require('../../tools/AskUserQuestionTool/UI');
    registerToolUI('ask_user_question', askUserUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const browserUI = require('../../tools/BrowserTool/UI');
    registerToolUI('browser', browserUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const codeAnalysisUI = require('../../tools/CodeAnalysisTool/UI');
    registerToolUI('code_analysis', codeAnalysisUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const monitorUI = require('../../tools/MonitorTool/UI');
    registerToolUI('monitor', monitorUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const pushNotifUI = require('../../tools/PushNotificationTool/UI');
    registerToolUI('push_notification', pushNotifUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const sleepUI = require('../../tools/SleepTool/UI');
    registerToolUI('sleep', sleepUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const subscribePRUI = require('../../tools/SubscribePRTool/UI');
    registerToolUI('subscribe_pr', subscribePRUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const taskOutputUI = require('../../tools/TaskOutputTool/UI');
    registerToolUI('task_output', taskOutputUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const taskStopUI = require('../../tools/TaskStopTool/UI');
    registerToolUI('task_stop', taskStopUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const timeUI = require('../../tools/TimeTool/UI');
    registerToolUI('time', timeUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const todoWriteUI = require('../../tools/TodoWriteTool/UI');
    registerToolUI('todo_write', todoWriteUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const toolSearchUI = require('../../tools/ToolSearchTool/UI');
    registerToolUI('tool_search', toolSearchUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const tungstenUI = require('../../tools/TungstenTool/UI');
    registerToolUI('tungsten', tungstenUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const voiceInputUI = require('../../tools/VoiceInputTool/UI');
    registerToolUI('voice_input', voiceInputUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }

  try {
    const voiceOutputUI = require('../../tools/VoiceOutputTool/UI');
    registerToolUI('voice_output', voiceOutputUI);
  } catch (err) {
    void handleError(err, { module: 'components:ui', action: 'catch_error' });
  }
}
