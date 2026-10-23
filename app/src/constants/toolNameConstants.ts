// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// D11-B（2026-10-11，用户裁定 B「全量常量表」）：**工具名的唯一来源**。
//
// 2026-10-19（U-03 收尾）：**由 `tools/toolNameConstants.ts` 迁入 `constants/`（infra 层）**。
// 原因：`runtime`（service 层）的 `CoreAPIImpl` 需要按工具名分支，但 `service → app(tools)`
// 是 R00-001 分层违规、`@modules/tools/toolNameConstants` 又是 R03-002 子目录 import 违规。
// 迁到 infra 后：`runtime → infra` / `tools(app) → infra` 均合法，且**仍是同一份表**（`tools/toolNameConstants.ts`
// 保留为纯转发，既有 70+ 引用零改动）。
//
// 约定：工具类 / loader / 生成器 / 门禁**一律**引用本表，不再各自写字面量
// （消除"声明名 ↔ 生效面"漂移，并为 G5 门禁提供可比对口径）。key = 工具名本身（标识符安全）。
//
// ⚠️ 表内**同时包含**"未进生效面"的工具名（它们不在生成物 `TOOL_NAMES` 内）
// ⇒ 本表即台账 D-40/D-41 所需的"被排除名清单"的事实来源。
// 差额集（2026-10-23 起 **2**，全部为 E 类未接线：`music_generate`/`tts`；
// `agents_list` / `kanban` / `mcp_auth` 已于同日 `rewrite` 后接线）。原先另有 6 个"下线类"影子工具
// （`nodes`/`session_status`/`sessions_send`/`sessions_spawn`/`update_plan`/`thinking`）
// 已按 Q-18 拍板摘除声明，并在 CD05 观察期后删除实现文件（两步均已完成）。
// 逐项保留理由与再评估触发条件见 P4a §2.3。
//
// ⚠️ 命名空间名（含 `:`，如 `office:workflow`）由运行期模块注册、键名非标识符 ⇒ 暂不入本表。

/**
 * 工具名常量表（唯一来源；工具类 / loader / 生成器 / 门禁一律引用本表）。
 *
 * @kind A
 */
export const TOOL_NAME_CONSTANTS = {
  agent: 'agent',
  agents_list: 'agents_list',
  ask_user_question: 'ask_user_question',
  audio_play: 'audio_play',
  bash: 'bash',
  brief: 'brief',
  broadcast: 'broadcast',
  browser: 'browser',
  browser_vision: 'browser_vision',
  canvas: 'canvas',
  channel: 'channel',
  clipboard: 'clipboard',
  code_run: 'code_run',
  computer_use: 'computer_use',
  config: 'config',
  create_project: 'create_project',
  create_task_list: 'create_task_list',
  cron_create: 'cron_create',
  cron_delete: 'cron_delete',
  cron_list: 'cron_list',
  cron_stop: 'cron_stop',
  doc_generate: 'doc_generate',
  enter_worktree: 'enter_worktree',
  exit_worktree: 'exit_worktree',
  file_convert: 'file_convert',
  file_edit: 'file_edit',
  file_read: 'file_read',
  file_write: 'file_write',
  get_task_list: 'get_task_list',
  glob: 'glob',
  grep: 'grep',
  image: 'image',
  image_analysis: 'image_analysis',
  image_display: 'image_display',
  image_generate: 'image_generate',
  image_svg_generate: 'image_svg_generate',
  kanban: 'kanban',
  knowledge_save: 'knowledge_save',
  list_peers: 'list_peers',
  list_vfs: 'list_vfs',
  lsp: 'lsp',
  mcp_auth: 'mcp_auth',
  mcp_resource: 'mcp_resource',
  mcp_tool: 'mcp_tool',
  monitor: 'monitor',
  music: 'music',
  music_generate: 'music_generate',
  notebook: 'notebook',
  pdf: 'pdf',
  plan: 'plan',
  powershell: 'powershell',
  read_project_file: 'read_project_file',
  read_vfs: 'read_vfs',
  repl: 'repl',
  save_conversation: 'save_conversation',
  send_message: 'send_message',
  sessions: 'sessions',
  sessions_yield: 'sessions_yield',
  skill: 'skill',
  skill_view: 'skill_view',
  skills_list: 'skills_list',
  sleep: 'sleep',
  sleep_for: 'sleep_for',
  sleep_until: 'sleep_until',
  stat_vfs: 'stat_vfs',
  task_output: 'task_output',
  task_stop: 'task_stop',
  team_create: 'team_create',
  team_delete: 'team_delete',
  todo_write: 'todo_write',
  tool_search: 'tool_search',
  trace_recording: 'trace_recording',
  tts: 'tts',
  tungsten: 'tungsten',
  update_task_status: 'update_task_status',
  video: 'video',
  video_analysis: 'video_analysis',
  video_display: 'video_display',
  video_generate: 'video_generate',
  web_fetch: 'web_fetch',
  web_search: 'web_search',
  write_project_file: 'write_project_file',
  write_vfs: 'write_vfs',
} as const;

/** 常量表里的名字联合类型（拼错 / 不存在 ⇒ typecheck 报错） */
export type ToolNameConstant =
  (typeof TOOL_NAME_CONSTANTS)[keyof typeof TOOL_NAME_CONSTANTS];
