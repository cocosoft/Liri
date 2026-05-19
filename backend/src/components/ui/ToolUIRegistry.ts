/**
 * 工具UI组件注册表
 *
 * 统一管理各工具的 UI 渲染函数映射。
 * 工具执行后通过此注册表自动查找对应的 UI 组件进行渲染。
 * 支持两级查找：先查注册表，再降级到工具实例的原生渲染方法。
 */

import type React from 'react';

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
  tool?: { renderToolUseMessage?: Function; renderToolResultMessage?: Function; renderToolUseErrorMessage?: Function; renderToolUseProgressMessage?: Function; getToolUseSummary?: Function }
): ToolUIRenderer | undefined {
  const registered = registry.get(toolName.toLowerCase());
  if (registered) return registered;

  if (!tool) return undefined;

  const fallback: ToolUIRenderer = {};
  if (typeof tool.renderToolUseMessage === 'function') {
    fallback.renderToolUseMessage = tool.renderToolUseMessage as ToolUIRenderer['renderToolUseMessage'];
  }
  if (typeof tool.renderToolResultMessage === 'function') {
    fallback.renderToolResultMessage = tool.renderToolResultMessage as ToolUIRenderer['renderToolResultMessage'];
  }
  if (typeof tool.renderToolUseErrorMessage === 'function') {
    fallback.renderToolUseErrorMessage = tool.renderToolUseErrorMessage as ToolUIRenderer['renderToolUseErrorMessage'];
  }
  if (typeof tool.renderToolUseProgressMessage === 'function') {
    fallback.renderToolUseProgressMessage = tool.renderToolUseProgressMessage as ToolUIRenderer['renderToolUseProgressMessage'];
  }
  if (typeof tool.getToolUseSummary === 'function') {
    fallback.getToolUseSummary = tool.getToolUseSummary as ToolUIRenderer['getToolUseSummary'];
  }

  return Object.keys(fallback).length > 0 ? fallback : undefined;
}

export function hasToolUI(toolName: string): boolean {
  return registry.has(toolName.toLowerCase());
}

export function getRegisteredToolNames(): string[] {
  return Array.from(registry.keys());
}

export function initDefaultToolUIRegistry(): void {
  try {
    const agentUI = require('../../tools/AgentTool/UI');
    registerToolUI('agent', agentUI);
    registerToolUI('agenttool', agentUI);
  } catch {}

  try {
    const fileReadUI = require('../../tools/FileReadTool/UI');
    registerToolUI('file_read', fileReadUI);
  } catch {}
  try {
    const fileWriteUI = require('../../tools/FileWriteTool/UI');
    registerToolUI('file_write', fileWriteUI);
  } catch {}
  try {
    const fileEditUI = require('../../tools/FileEditTool/UI');
    registerToolUI('file_edit', fileEditUI);
  } catch {}

  try {
    const bashUI = require('../../tools/BashTool/UI');
    registerToolUI('bash', bashUI);
  } catch {}

  try {
    const grepUI = require('../../tools/search/GrepUI');
    registerToolUI('grep', grepUI);
  } catch {}

  try {
    const globUI = require('../../tools/search/GlobUI');
    registerToolUI('glob', globUI);
  } catch {}

  try {
    const webFetchUI = require('../../tools/WebFetchTool/UI');
    registerToolUI('web_fetch', webFetchUI);
  } catch {}

  try {
    const webSearchUI = require('../../tools/WebSearchTool/UI');
    registerToolUI('web_search', webSearchUI);
  } catch {}

  try {
    const skillUI = require('../../tools/SkillTool/UI');
    registerToolUI('skill', skillUI);
  } catch {}

  try {
    const planUI = require('../../tools/PlanTool/UI');
    registerToolUI('enter_plan_mode', planUI);
    registerToolUI('exit_plan_mode', planUI);
  } catch {}

  try {
    const taskUI = require('../../tools/TaskTool/UI');
    registerToolUI('task', taskUI);
    registerToolUI('task_update', taskUI);
    registerToolUI('task_get', taskUI);
    registerToolUI('task_list', taskUI);
  } catch {}

  try {
    const briefUI = require('../../tools/BriefTool/UI');
    registerToolUI('brief', briefUI);
  } catch {}

  try {
    const lspUI = require('../../tools/LSPTool/UI');
    registerToolUI('lsp', lspUI);
  } catch {}

  try {
    const configUI = require('../../tools/ConfigTool/UI');
    registerToolUI('config', configUI);
  } catch {}

  try {
    const chronosUI = require('../../tools/ChronosTool/UI');
    registerToolUI('cron_create', chronosUI);
    registerToolUI('cron_delete', chronosUI);
    registerToolUI('cron_list', chronosUI);
  } catch {}

  try {
    const pwshUI = require('../../tools/PowerShellTool/UI');
    registerToolUI('powershell', pwshUI);
  } catch {}

  try {
    const teamCreateUI = require('../../tools/TeamCreateTool/UI');
    registerToolUI('team_create', teamCreateUI);
  } catch {}

  try {
    const teamDeleteUI = require('../../tools/TeamDeleteTool/UI');
    registerToolUI('team_delete', teamDeleteUI);
  } catch {}

  try {
    const sendMsgUI = require('../../tools/SendMessageTool/UI');
    registerToolUI('send_message', sendMsgUI);
  } catch {}

  try {
    const mcpUI = require('../../tools/MCPResourceTool/UI');
    registerToolUI('mcp', mcpUI);
    registerToolUI('list_mcp_resources', mcpUI);
    registerToolUI('read_mcp_resource', mcpUI);
  } catch {}

  try {
    const worktreeEnterUI = require('../../tools/EnterWorktreeTool/UI');
    registerToolUI('enter_worktree', worktreeEnterUI);
  } catch {}

  try {
    const worktreeExitUI = require('../../tools/ExitWorktreeTool/UI');
    registerToolUI('exit_worktree', worktreeExitUI);
  } catch {}

  try {
    const peersUI = require('../../tools/ListPeersTool/UI');
    registerToolUI('list_peers', peersUI);
  } catch {}
}
