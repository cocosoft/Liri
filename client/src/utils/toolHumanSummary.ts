/**
 * 工具调用"人话"摘要映射表
 *
 * 将技术化的工具名称和参数转化为用户可读的自然语言描述。
 * 用于替代 ToolCallBlock 中逐行罗列 key=value 的调试风格展示。
 *
 * 使用方式：
 *   const summary = getToolHumanSummary(toolCall.name, toolCall.arguments);
 *   // "正在搜索代码：src/utils/common.ts"
 *
 * 多语言扩展预留：summary 函数签名接收参数对象，未来可改为 t('tool.xxx', args) 形式。
 */

import type { ToolCall } from "../types";

/** 工具名 → 中文显示名 */
const TOOL_NAME_MAP: Record<string, string> = {
  // ---- 搜索类 ----
  web_search: "网络搜索",
  web_fetch: "网页获取",
  "web-search": "网络搜索",
  "web-fetch": "网页获取",
  grep: "文本搜索",
  glob: "文件搜索",
  file_search: "文件搜索",
  search_knowledge: "搜索知识库",

  // ---- 文件操作类 ----
  file_read: "读取文件",
  file_write: "写入文件",
  file_edit: "编辑文件",
  file_delete: "删除文件",
  file_create: "创建文件",
  file_convert: "文件转换",

  // ---- 执行类 ----
  bash: "终端命令",
  powershell: "PowerShell",
  execute: "执行命令",
  run: "运行",
  shell: "终端命令",

  // ---- 通用操作 ----
  fetch: "获取内容",
  list: "列出",
  query: "查询",
  build_index: "构建索引",

  // ---- 任务与规划类 ----
  todo_write: "任务管理",
  plan: "规划",
  ask_user_question: "询问用户",
  save_conversation: "保存会话",
  brief: "生成摘要",
  sessions: "会话管理",

  // ---- 内容生成类 ----
  image_generate: "生成图片",
  image_analysis: "分析图片",
  image_svg_generate: "生成 SVG 图片",
  music_generate: "生成音乐",
  video_generate: "生成视频",
  tts: "文字转语音",
  image: "图片处理",
  canvas: "画布操作",

  // ---- 系统工具类 ----
  clipboard: "剪贴板",
  computer_use: "电脑操作",
  notebook: "笔记本",
  channel: "发送消息",
  channel_manager: "频道管理",
  broadcast: "广播消息",
  gateway: "网关",

  // ---- MCP ----
  mcp_resource: "MCP 资源",

  // ---- 任务编排 ----
  create_task_list: "创建任务列表",
  view_tasks: "查看任务",
  abort_task: "中止任务",
  view_plan: "查看规划",
  update_task_status: "更新任务状态",
  get_task_list: "获取任务列表",
  task_output: "任务输出",
  task_stop: "停止任务",
};

/**
 * 获取工具的中文显示名
 */
export function getToolDisplayName(toolName: string): string {
  return TOOL_NAME_MAP[toolName] || toolName;
}

/**
 * 获取工具体的中文人话摘要
 *
 * 根据工具名和参数生成一行自然语言描述，替代原始的 key=value 罗列。
 * 折叠态只显示这一行摘要，展开态才显示完整参数。
 */
export function getToolHumanSummary(toolCall: ToolCall): string {
  const args = (toolCall.arguments || {}) as Record<string, unknown>;
  const name = toolCall.name;

  switch (name) {
    // ---- 搜索类 ----
    case "grep":
      return formatSummary("正在搜索代码", getArgStr(args, "pattern"));
    case "glob":
    case "file_search":
      return formatSummary("正在搜索文件", getArgStr(args, "pattern"));
    case "web_search":
    case "web-search":
      return formatSummary("正在网络搜索", getArgStr(args, "query"));
    case "web_fetch":
    case "web-fetch":
      return formatSummary("正在获取网页", summarizeUrl(args));
    case "search_knowledge":
      return formatSummary("正在搜索知识库", getArgStr(args, "query"));

    // ---- 文件操作类 ----
    case "file_read":
    case "read":
      return formatSummary("正在读取", getArgStr(args, "file_path", "path"));
    case "file_write":
    case "write":
      return formatSummary("正在写入", `${getArgStr(args, "file_path", "path")}${summarizeSize(args)}`);
    case "file_edit":
      return formatSummary("正在编辑", getArgStr(args, "file_path", "path"));
    case "file_delete":
    case "delete":
      return formatSummary("正在删除", getArgStr(args, "file_path", "path"));
    case "file_create":
    case "create":
      return formatSummary("正在创建", getArgStr(args, "file_path", "path") || getArgStr(args, "name"));
    case "file_convert":
      return formatSummary("正在转换文件", getArgStr(args, "file_path", "path", "input"));

    // ---- 执行类 ----
    case "bash":
    case "powershell":
    case "shell":
    case "execute":
      return formatSummary("正在执行命令", summarizeCommand(args));
    case "run":
      return formatSummary("正在运行", getArgStr(args, "command") || getArgStr(args, "script"));

    // ---- 任务与规划类 ----
    case "todo_write":
      return summarizeTodoWrite(args);
    case "plan":
      return formatSummary("正在规划", getArgStr(args, "title") || getArgStr(args, "name"));
    case "ask_user_question":
      return formatSummary("正在询问用户", getArgStr(args, "question"));
    case "save_conversation":
      return formatSummary("正在保存会话", getArgStr(args, "title") || getArgStr(args, "name"));
    case "brief":
      return "正在生成会话摘要";
    case "sessions":
      return formatSummary("正在管理会话", getArgStr(args, "action"));

    // ---- 内容生成类 ----
    case "image_generate":
      return formatSummary("正在生成图片", getArgStr(args, "prompt"));
    case "image":
      return formatSummary("正在编辑图片", getArgStr(args, "action"));
    case "image_analysis":
      return formatSummary("正在分析图片", getArgStr(args, "action") || getArgStr(args, "image_path", "path"));
    case "image_svg_generate":
      return formatSummary("正在生成 SVG", getArgStr(args, "prompt"));
    case "music_generate":
      return formatSummary("正在生成音乐", getArgStr(args, "prompt"));
    case "video_generate":
      return formatSummary("正在生成视频", getArgStr(args, "prompt"));
    case "tts":
      return formatSummary("正在合成语音", getArgStr(args, "text"));
    case "canvas":
      return formatSummary("正在操作画布", getArgStr(args, "action"));

    // ---- 系统工具类 ----
    case "clipboard":
      return formatSummary("正在操作剪贴板", getArgStr(args, "action"));
    case "computer_use":
      return formatSummary("正在模拟操作", getArgStr(args, "action"));
    case "notebook":
      return formatSummary("正在编辑笔记本", getArgStr(args, "action"));
    case "channel":
    case "channel_manager":
    case "broadcast":
    case "gateway":
      return formatSummary("正在发送消息", getArgStr(args, "content"));

    // ---- 任务编排 ----
    case "create_task_list":
      return formatSummary("创建任务列表", getArgStr(args, "title"));
    case "view_tasks":
    case "get_task_list":
      return "查看任务列表";
    case "abort_task":
    case "task_stop":
      return formatSummary("正在停止任务", getArgStr(args, "task_id", "id"));
    case "view_plan":
      return "查看规划";
    case "update_task_status":
      return formatSummary("更新任务状态", getArgStr(args, "task_id", "id"));
    case "task_output":
      return formatSummary("获取任务输出", getArgStr(args, "task_id", "id"));

    // ---- MCP ----
    case "mcp_resource":
      return formatSummary("正在访问 MCP 资源", getArgStr(args, "resource", "name"));

    // ---- 通用 ----
    case "fetch":
      return formatSummary("正在获取", summarizeUrl(args));
    case "list":
      return formatSummary("正在列出", getArgStr(args, "path") || getArgStr(args, "type"));
    case "query":
      return formatSummary("正在查询", getArgStr(args, "query") || getArgStr(args, "sql"));
    case "build_index":
      return formatSummary("正在构建索引", getArgStr(args, "path") || getArgStr(args, "name"));

    default:
      // 未知工具：显示工具名 + 第一个参数值
      const firstArg = Object.values(args)[0];
      const firstArgStr = typeof firstArg === "string" ? firstArg : "";
      if (firstArgStr) {
        return formatSummary(name, firstArgStr.length > 30 ? firstArgStr.slice(0, 30) + "..." : firstArgStr);
      }
      return name;
  }
}

// ============================================================
// 内部辅助函数
// ============================================================

/** 从参数中获取字符串值，支持多个备选 key */
function getArgStr(args: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const val = args[key];
    if (typeof val === "string" && val.length > 0) {
      return val.length > 40 ? val.slice(0, 40) + "..." : val;
    }
  }
  return "";
}

/** 格式化摘要：有内容时用冒号分隔，无内容时只显示操作 */
function formatSummary(action: string, detail: string): string {
  return detail ? `${action}：${detail}` : action;
}

/** 摘要 URL：提取域名 + 路径 */
function summarizeUrl(args: Record<string, unknown>): string {
  const url = getArgStr(args, "url", "link", "href");
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return parsed.hostname + (parsed.pathname !== "/" ? parsed.pathname : "");
  } catch {
    return url;
  }
}

/** 摘要命令：截取前 40 字符 */
function summarizeCommand(args: Record<string, unknown>): string {
  const cmd = getArgStr(args, "command", "cmd", "script");
  if (!cmd) return "";
  return cmd.length > 40 ? cmd.slice(0, 40) + "..." : cmd;
}

/** 摘要文件大小 */
function summarizeSize(args: Record<string, unknown>): string {
  const size = args["size"];
  const content = args["content"];
  if (typeof size === "number" && size > 0) {
    if (size < 1024) return ` (${size} 字符)`;
    if (size < 1024 * 1024) return ` (${(size / 1024).toFixed(1)} KB)`;
    return ` (${(size / 1024 / 1024).toFixed(1)} MB)`;
  }
  if (typeof content === "string") {
    return ` (${content.length} 字符)`;
  }
  return "";
}

/** 摘要 todo_write：区分创建/更新/标记完成 */
function summarizeTodoWrite(args: Record<string, unknown>): string {
  const action = getArgStr(args, "action");
  const todos = args["todos"] as Array<Record<string, unknown>> | undefined;

  switch (action) {
    case "create":
      if (todos && todos.length > 0) {
        const names = todos.map((t) => t["content"] || "").filter(Boolean);
        return `创建了 ${todos.length} 个任务：${names.slice(0, 3).join("、")}${names.length > 3 ? "等" : ""}`;
      }
      return "创建任务";
    case "update":
      if (todos && todos.length > 0) {
        const first = todos[0];
        const status = first["status"];
        if (status === "completed") return `完成了任务：${first["content"] || ""}`;
        if (status === "in_progress") return `开始执行：${first["content"] || ""}`;
        return `更新了任务：${first["content"] || ""}`;
      }
      return "更新任务状态";
    case "complete":
      return `完成了任务：${getArgStr(args, "id") || getArgStr(args, "name")}`;
    default:
      return "管理任务";
  }
}

// ============================================================
// 工具调用参数键名 → 中文显示名映射
// ============================================================

/** 参数键名 → 中文显示名 */
const ARG_KEY_LABEL_MAP: Record<string, string> = {
  file_path: "文件路径",
  url: "链接",
  query: "查询",
  pattern: "模式",
  command: "命令",
  path: "路径",
  keywords: "关键词",
  code: "代码",
  language: "语言",
  content: "内容",
  output: "输出",
};

/**
 * 获取参数键名的中文显示名
 */
export function getArgKeyLabel(key: string): string {
  return ARG_KEY_LABEL_MAP[key] || key;
}