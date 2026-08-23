/**
 * 工具分类与按任务裁剪配置（Step 1 + Step 2）
 *
 * 背景：streamMessageFlow 当前把全部注册工具（约 50-60 个，~10K tokens）发给模型，
 * 小上下文（如 llama.cpp 8K）下工具定义放不进，preSendContextProtection 只能整体移除
 * → 模型无工具可用。本配置提供「工具 → 类别」与「任务 → 类别」两张静态映射，
 * 供裁剪注入点（streamMessageFlow）按任务只注入相关子集（Step 3）。
 *
 * 设计约束：
 *  - 映射以**工具名**为 key（ToolRegistry.getToolSchemas 的 schema.name），
 *    不改工具注册结构，纯静态常量，零侵入。
 *  - 未列出的工具默认归 `misc`（保留在默认集，避免裁剪后无工具可用）。
 *  - 类别为英文内部 key；任务类型对齐 modelRouter.ts 的 TaskType。
 */

// ============================================================
// Step 1: 工具类别定义
// ============================================================

export type ToolCategory =
  | 'file' // 文件写入/转换/项目文件写入
  | 'file_read' // 文件只读（读/glob/项目文件读）— 本地模型轻量集专用
  | 'shell' // 终端命令（bash/powershell）
  | 'code' // 代码/LSP/项目创建/git
  | 'search' // 代码搜索/Web 搜索/工具搜索
  | 'network' // 网络抓取
  | 'image' // 图像生成/分析/处理
  | 'video' // 视频生成/分析/处理
  | 'media' // 音频/PDF/二维码/媒体元数据
  | 'task' // 任务/todo/cron
  | 'session' // 会话保存/管理
  | 'agent' // SubAgent/团队协作
  | 'system' // 监控/追踪/时间/配置/通用
  | 'interaction' // 提问/简报
  | 'doc' // 文档生成/office 工作流
  | 'notify' // 消息/通知
  | 'channel' // 通道/广播
  | 'calendar' // 日历
  | 'mail' // 邮件
  | 'misc'; // 未分类（保底保留）

/** 工具名 → 类别映射（覆盖运行时内置 + 模块注册工具） */
export const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  // ── file_read 文件只读（本地模型轻量集可用） ──
  file_read: 'file_read',
  glob: 'file_read',
  read_project_file: 'file_read',
  // ── file 文件写入/转换 ──
  file_write: 'file',
  file_edit: 'file',
  file_convert: 'file',
  write_project_file: 'file',

  // ── shell 终端 ──
  bash: 'shell',
  powershell: 'shell',

  // ── code 代码 ──
  lsp: 'code',
  create_project: 'code',

  // ── search 搜索 ──
  grep: 'search',
  web_search: 'search',
  tool_search: 'search',
  search_codebase: 'search',

  // ── network 网络 ──
  web_fetch: 'network',

  // ── image 图像 ──
  image: 'image',
  image_analysis: 'image',
  image_generate: 'image',
  image_svg_generate: 'image',
  image_display: 'image',
  'media:image:convert': 'image',
  'media:image:resize': 'image',
  'media:image:crop': 'image',
  'media:image:rotate': 'image',
  'media:image:watermark': 'image',
  'media:image:adjust': 'image',

  // ── video 视频 ──
  video: 'video',
  video_analysis: 'video',
  video_generate: 'video',
  video_display: 'video',
  browser_vision: 'video',
  'media:video:compress': 'video',
  'media:video:extract-audio': 'video',
  'media:video:extract-thumbnail': 'video',

  // ── media 其他媒体 ──
  audio_play: 'media',
  music: 'media',
  'media:info': 'media',
  'media:delete': 'media',
  'media:deleteBatch': 'media',
  'media:qr:generate': 'media',
  'media:qr:decode': 'media',
  'media:pdf:extract': 'media',

  // ── task 任务/todo/cron ──
  todo_write: 'task',
  task_stop: 'task',
  create_task_list: 'task',
  update_task_status: 'task',
  get_task_list: 'task',
  cron_create: 'task',
  cron_delete: 'task',
  cron_list: 'task',
  cron_stop: 'task',

  // ── session 会话 ──
  save_conversation: 'session',
  sessions: 'session',

  // ── agent 代理 ──
  Agent: 'agent',
  TeamCreate: 'agent',
  TeamDelete: 'agent',

  // ── system 系统 ──
  MonitorTool: 'system',
  TraceRecordingTool: 'system',
  time: 'system',
  sleep: 'system',
  config: 'system',
  repl: 'system',
  notebook: 'system',
  EnterWorktree: 'system',
  ExitWorktree: 'system',

  // ── interaction 交互 ──
  ask_user_question: 'interaction',
  brief: 'interaction',

  // ── doc 文档 ──
  doc_generate: 'doc',
  'office:workflow': 'doc',

  // ── notify 消息/通知 ──
  send_message: 'notify',
  push_notification: 'notify',
  subscribe_pr: 'notify',

  // ── channel 通道 ──
  channel: 'channel',
  broadcast: 'channel',
  ListPeers: 'channel',

  // ── calendar 日历 ──
  'calendar:add': 'calendar',
  'calendar:list': 'calendar',
  'calendar:update': 'calendar',
  'calendar:delete': 'calendar',

  // ── mail 邮件 ──
  'mail:send': 'mail',

  // ── misc 其他（有实质用途但不宜默认裁剪） ──
  canvas: 'misc',
  clipboard: 'misc',
  browser: 'misc',
  plan: 'misc',
  computer_use: 'misc',
  MCPTool: 'misc',
  mcp_resource: 'misc',
  ListMcpResources: 'misc',
  ReadMcpResource: 'misc',
  Skill: 'misc',
};

/**
 * 获取工具类别；未命中（未登记的工具）→ 'misc'（保底保留）。
 */
export function getToolCategory(toolName: string): ToolCategory {
  return TOOL_CATEGORIES[toolName] ?? 'misc';
}

// ============================================================
// Step 2: 任务 → 工具类别映射
// 任务类型对齐 modelRouter.ts 的 TaskType
// ============================================================

/**
 * 各任务的工具类别白名单。裁剪时只保留命中这些类别的工具。
 * 未列出的任务类型 → 回退 `default` 保底集。
 */
export const TASK_TOOL_CATEGORIES: Record<string, ToolCategory[]> = {
  // 日常对话：轻量只读为主（文件读、搜索、网络、交互、会话、系统）
  chat: [
    'file',
    'file_read',
    'search',
    'network',
    'interaction',
    'session',
    'system',
  ],
  // 通用兜底（与 chat 一致，避免裁剪后无工具）
  default: [
    'file',
    'file_read',
    'search',
    'network',
    'interaction',
    'session',
    'system',
  ],
  // 简单问答/摘要：最轻量
  quick: ['search', 'network', 'system'],
  // 翻译润色：文件读 + 轻量
  translation: ['file', 'file_read', 'search', 'system'],
  // 编码：文件 + 终端 + 代码 + 搜索 + 网络 + 任务 + 系统
  coding: [
    'file',
    'file_read',
    'shell',
    'code',
    'search',
    'network',
    'task',
    'system',
  ],
  // 自主代理：编码全集 + 代理 + 会话
  agent: [
    'file',
    'file_read',
    'shell',
    'code',
    'search',
    'network',
    'task',
    'agent',
    'session',
    'system',
  ],
  // 定时任务：任务管理 + 通知 + 系统
  scheduled: ['task', 'notify', 'system'],
  // 图片生成/分析
  image: ['image', 'file', 'file_read', 'search', 'system'],
  vision: ['image', 'file', 'file_read', 'system'],
  ocr: ['image', 'file', 'file_read', 'system'],
  // 视频
  video: ['video', 'file', 'file_read', 'media', 'system'],
  text_to_video: ['video', 'file', 'file_read', 'media', 'system'],
  image_to_video: ['video', 'image', 'file', 'file_read', 'media', 'system'],
  // 语音
  tts: ['media', 'system'],
  stt: ['media', 'system'],
  // 本地模型（Ollama/llama.cpp）：工具能力弱 + 上下文小，只保留最小只读集 + 提问交互。
  // 9 个工具（file_read 3 + search 4 + interaction 2），工具定义 ~1.4K tokens，
  // 使 8K 窗口下工具定义能真正发送（此前 19 个 ~2.9K tokens 超预算被整体移除 → 模型无工具）。
  local: ['file_read', 'search', 'interaction'],
  // 向量化/知识库：无工具需求（非对话任务）
  embedding: [],
  reranking: [],
  knowledge_compile: [],
};

/** 任务类型裁剪时默认回退的任务 key（保底，避免裁剪后工具集为空） */
export const DEFAULT_TASK_KEY = 'default';

/**
 * 获取任务的工具类别白名单；未配置的任务回退 default 保底集。
 */
export function getTaskToolCategories(
  taskType: string | undefined
): ToolCategory[] {
  const categories = taskType ? TASK_TOOL_CATEGORIES[taskType] : undefined;
  return categories ?? TASK_TOOL_CATEGORIES[DEFAULT_TASK_KEY];
}

/**
 * 按任务过滤工具定义（Step 3 裁剪注入点使用）。
 * 兼容 OpenAI 兼容结构（name 在顶层或 function.name）。
 * @param toolDefinitions 待过滤的工具定义列表
 * @param taskType 当前任务类型
 * @returns 仅包含任务类别白名单内工具的列表
 */
export function filterToolsByTask<
  T extends { name?: string; function?: { name?: string } },
>(toolDefinitions: T[], taskType: string | undefined): T[] {
  const allowed = new Set(getTaskToolCategories(taskType));
  return toolDefinitions.filter((t) => {
    const toolName = t.name ?? t.function?.name ?? '';
    return allowed.has(getToolCategory(toolName));
  });
}
