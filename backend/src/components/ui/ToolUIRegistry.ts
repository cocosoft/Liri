/**
 * 工具UI组件注册表
 *
 * 统一管理各工具的 UI 渲染函数映射。
 * 工具执行后通过此注册表自动查找对应的 UI 组件进行渲染。
 */

import type React from 'react'

export interface ToolUIRenderer {
  renderToolUseMessage?: (
    input: any,
    options: { verbose: boolean },
  ) => React.ReactNode

  renderToolResultMessage?: (
    output: any,
    progressMessages: any[],
    options: { verbose: boolean },
  ) => React.ReactNode

  renderToolUseErrorMessage?: (
    error: string,
    options: { verbose: boolean },
  ) => React.ReactNode

  renderToolUseProgressMessage?: (data: any) => React.ReactNode

  getToolUseSummary?: (input: any) => string | null
}

const registry = new Map<string, ToolUIRenderer>()

export function registerToolUI(toolName: string, renderer: ToolUIRenderer): void {
  registry.set(toolName.toLowerCase(), renderer)
}

export function getToolUI(toolName: string): ToolUIRenderer | undefined {
  return registry.get(toolName.toLowerCase())
}

export function hasToolUI(toolName: string): boolean {
  return registry.has(toolName.toLowerCase())
}

export function getRegisteredToolNames(): string[] {
  return Array.from(registry.keys())
}

export function initDefaultToolUIRegistry(): void {
  try {
    const agentUI = require('../../tools/AgentTool/UI')
    registerToolUI('agent', agentUI)
    registerToolUI('agenttool', agentUI)
  } catch {}

  try {
    const fileUI = require('../../tools/filesystem/UI')
    registerToolUI('file_read', fileUI)
    registerToolUI('file_edit', fileUI)
    registerToolUI('file_write', fileUI)
  } catch {}

  try {
    const bashUI = require('../../tools/BashTool/UI')
    registerToolUI('bash', bashUI)
  } catch {}

  try {
    const grepUI = require('../../tools/search/GrepUI')
    registerToolUI('grep', grepUI)
  } catch {}

  try {
    const globUI = require('../../tools/search/GlobUI')
    registerToolUI('glob', globUI)
  } catch {}

  try {
    const webFetchUI = require('../../tools/WebFetchTool/UI')
    registerToolUI('web_fetch', webFetchUI)
  } catch {}

  try {
    const webSearchUI = require('../../tools/WebSearchTool/UI')
    registerToolUI('web_search', webSearchUI)
  } catch {}

  try {
    const skillUI = require('../../tools/SkillTool/UI')
    registerToolUI('skill', skillUI)
  } catch {}

  try {
    const planUI = require('../../tools/PlanTool/UI')
    registerToolUI('enter_plan_mode', planUI)
    registerToolUI('exit_plan_mode', planUI)
  } catch {}

  try {
    const taskUI = require('../../tools/TaskTool/UI')
    registerToolUI('task', taskUI)
    registerToolUI('task_update', taskUI)
    registerToolUI('task_get', taskUI)
    registerToolUI('task_list', taskUI)
  } catch {}

  try {
    const briefUI = require('../../tools/BriefTool/UI')
    registerToolUI('brief', briefUI)
  } catch {}

  try {
    const lspUI = require('../../tools/LSPTool/UI')
    registerToolUI('lsp', lspUI)
  } catch {}

  try {
    const configUI = require('../../tools/ConfigTool/UI')
    registerToolUI('config', configUI)
  } catch {}

  try {
    const chronosUI = require('../../tools/ChronosTool/UI')
    registerToolUI('cron_create', chronosUI)
    registerToolUI('cron_delete', chronosUI)
    registerToolUI('cron_list', chronosUI)
  } catch {}

  try {
    const notebookUI = require('../../tools/NotebookEditTool/UI')
    registerToolUI('notebook_edit', notebookUI)
  } catch {}

  try {
    const pwshUI = require('../../tools/PowerShellTool/UI')
    registerToolUI('powershell', pwshUI)
  } catch {}

  try {
    const teamCreateUI = require('../../tools/TeamCreateTool/UI')
    registerToolUI('team_create', teamCreateUI)
  } catch {}

  try {
    const teamDeleteUI = require('../../tools/TeamDeleteTool/UI')
    registerToolUI('team_delete', teamDeleteUI)
  } catch {}

  try {
    const sendMsgUI = require('../../tools/SendMessageTool/UI')
    registerToolUI('send_message', sendMsgUI)
  } catch {}

  try {
    const mcpUI = require('../../tools/MCPResourceTool/UI')
    registerToolUI('mcp', mcpUI)
    registerToolUI('list_mcp_resources', mcpUI)
    registerToolUI('read_mcp_resource', mcpUI)
  } catch {}

  try {
    const worktreeEnterUI = require('../../tools/EnterWorktreeTool/UI')
    registerToolUI('enter_worktree', worktreeEnterUI)
  } catch {}

  try {
    const worktreeExitUI = require('../../tools/ExitWorktreeTool/UI')
    registerToolUI('exit_worktree', worktreeExitUI)
  } catch {}

  try {
    const peersUI = require('../../tools/ListPeersTool/UI')
    registerToolUI('list_peers', peersUI)
  } catch {}
}
