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

import i18n from "../i18n";
import type { ToolCall } from "../types";

/**
 * 多媒体结果类工具名（P2-2 收敛：全仓单一定义处）
 *
 * 语义 A —— 结果应走 ImageToolResult 专用渲染，而非裸 JSON。
 */
const MEDIA_TOOL_NAMES: readonly string[] = [
  "image_generate",
  "image_svg_generate",
  "image_analysis",
  "image_display",
  "video_display",
  "audio_play",
  "canvas",
  "image",
];

/**
 * 多媒体展示类工具名（P2-2 收敛：全仓单一定义处）
 *
 * 语义 B —— 内容是用户要看的结果（图片/视频/音频），
 * 默认展开，且不被折叠进"工具执行"组。
 */
const MEDIA_DISPLAY_TOOL_NAMES: readonly string[] = [
  "image_display",
  "video_display",
  "audio_play",
];

const MEDIA_TOOL_SET = new Set(MEDIA_TOOL_NAMES);
const MEDIA_DISPLAY_TOOL_SET = new Set(MEDIA_DISPLAY_TOOL_NAMES);

/** 是否多媒体结果类工具（决定工具结果用 ImageToolResult 渲染） */
export function isMediaToolName(name: string | undefined): boolean {
  return name != null && MEDIA_TOOL_SET.has(name);
}

/** 是否多媒体展示类工具（决定默认展开、跳过折叠分组） */
export function isMediaDisplayToolName(name: string | undefined): boolean {
  return name != null && MEDIA_DISPLAY_TOOL_SET.has(name);
}

/** 工具名 → i18n 显示名键（tool.name.<工具名>） */
const TOOL_NAME_MAP: Record<string, string> = {
  // ---- 搜索类 ----
  web_search: "tool.name.web_search",
  web_fetch: "tool.name.web_fetch",
  "web-search": "tool.name.web-search",
  "web-fetch": "tool.name.web-fetch",
  grep: "tool.name.grep",
  glob: "tool.name.glob",
  search_knowledge: "tool.name.search_knowledge",

  // ---- 文件操作类 ----
  file_read: "tool.name.file_read",
  file_write: "tool.name.file_write",
  file_edit: "tool.name.file_edit",
  file_delete: "tool.name.file_delete",
  file_create: "tool.name.file_create",
  file_convert: "tool.name.file_convert",

  // ---- 执行类 ----
  bash: "tool.name.bash",
  powershell: "tool.name.powershell",
  execute: "tool.name.execute",
  run: "tool.name.run",
  shell: "tool.name.shell",

  // ---- 通用操作 ----
  fetch: "tool.name.fetch",
  list: "tool.name.list",
  query: "tool.name.query",
  build_index: "tool.name.build_index",

  // ---- 任务与规划类 ----
  todo_write: "tool.name.todo_write",
  plan: "tool.name.plan",
  ask_user_question: "tool.name.ask_user_question",
  save_conversation: "tool.name.save_conversation",
  brief: "tool.name.brief",
  sessions: "tool.name.sessions",

  // ---- 内容生成类 ----
  image_generate: "tool.name.image_generate",
  doc_generate: "tool.name.doc_generate",
  image_analysis: "tool.name.image_analysis",
  image_svg_generate: "tool.name.image_svg_generate",
  image_display: "tool.name.image_display",
  video_display: "tool.name.video_display",
  audio_play: "tool.name.audio_play",
  music_generate: "tool.name.music_generate",
  video_generate: "tool.name.video_generate",
  tts: "tool.name.tts",
  image: "tool.name.image",
  canvas: "tool.name.canvas",

  // ---- 系统工具类 ----
  clipboard: "tool.name.clipboard",
  computer_use: "tool.name.computer_use",
  notebook: "tool.name.notebook",
  channel: "tool.name.channel",
  channel_manager: "tool.name.channel_manager",
  broadcast: "tool.name.broadcast",
  gateway: "tool.name.gateway",
  browser: "tool.name.browser",
  agents_list: "tool.name.agents_list",
  cron_create: "tool.name.cron_create",

  // ---- MCP ----
  mcp_resource: "tool.name.mcp_resource",

  // ---- 任务编排 ----
  create_task_list: "tool.name.create_task_list",
  view_tasks: "tool.name.view_tasks",
  abort_task: "tool.name.abort_task",
  view_plan: "tool.name.view_plan",
  update_task_status: "tool.name.update_task_status",
  get_task_list: "tool.name.get_task_list",
  task_output: "tool.name.task_output",
  task_stop: "tool.name.task_stop",
};

/**
 * 获取工具的中文显示名
 */
export function getToolDisplayName(toolName: string): string {
  const key = TOOL_NAME_MAP[toolName];
  return key ? i18n.t(key) : toolName;
}

/**
 * 获取工具体的中文人话摘要
 *
 * 根据工具名和参数生成一行自然语言描述，替代原始的 key=value 罗列。
 * 折叠态只显示这一行摘要，展开态才显示完整参数。
 */
export function getToolHumanSummary(toolCall: ToolCall): string {
  return applyStatusTense(buildToolHumanSummary(toolCall), toolCall.status);
}

/**
 * P1-8 / P1-21（2026-09-27 真机 + 导出产物实证）：摘要时态随调用状态变化。
 *
 * 原实现恒用"正在…"，已完成的调用（状态图标 `✓`）旁配"正在写入：…"语义矛盾，
 * 导出件里"已完成"的记录同样读起来像进行中。此处只在**终态**改为过去式，
 * 进行中/待执行保持"正在…"（`正在` → `已`，其余动作短语不带时态、原样保留）。
 */
function applyStatusTense(
  summary: string,
  status?: ToolCall["status"],
): string {
  const isFinal = status === "completed" || status === "failed";
  const presentTense = i18n.t("tool.summary.tensePresent");
  if (!isFinal || !summary.startsWith(presentTense)) return summary;
  return `${i18n.t("tool.summary.tensePast")}${summary.slice(presentTense.length)}`;
}

/** 摘要主体（不含时态） */
function buildToolHumanSummary(toolCall: ToolCall): string {
  const args = (toolCall.arguments || {}) as Record<string, unknown>;
  const name = toolCall.name;

  switch (name) {
    // ---- 搜索类 ----
    case "grep":
      return formatSummary(
        i18n.t("tool.summary.searchingCode"),
        getArgStr(args, "pattern"),
      );
    case "glob":
      return formatSummary(
        i18n.t("tool.summary.searchingFiles"),
        getArgStr(args, "pattern"),
      );
    case "web_search":
    case "web-search":
      return formatSummary(
        i18n.t("tool.summary.searchingWeb"),
        getArgStr(args, "query"),
      );
    case "web_fetch":
    case "web-fetch":
      return formatSummary(
        i18n.t("tool.summary.fetchingPage"),
        summarizeUrl(args),
      );
    case "search_knowledge":
      return formatSummary(
        i18n.t("tool.summary.searchingKnowledge"),
        getArgStr(args, "query"),
      );

    // ---- 文件操作类 ----
    case "file_read":
    case "read":
      return formatSummary(
        i18n.t("tool.summary.reading"),
        getArgStr(args, "file_path", "path"),
      );
    case "file_write":
    case "write":
      return formatSummary(
        i18n.t("tool.summary.writing"),
        `${getArgStr(args, "file_path", "path")}${summarizeSize(args)}`,
      );
    case "file_edit":
      return formatSummary(
        i18n.t("tool.summary.editing"),
        getArgStr(args, "file_path", "path"),
      );
    case "file_delete":
    case "delete":
      return formatSummary(
        i18n.t("tool.summary.deleting"),
        getArgStr(args, "file_path", "path"),
      );
    case "file_create":
    case "create":
      return formatSummary(
        i18n.t("tool.summary.creating"),
        getArgStr(args, "file_path", "path") || getArgStr(args, "name"),
      );
    case "file_convert":
      return formatSummary(
        i18n.t("tool.summary.convertingFile"),
        getArgStr(args, "file_path", "path", "input"),
      );

    // ---- 执行类 ----
    case "bash":
    case "powershell":
    case "shell":
    case "execute":
      return formatSummary(
        i18n.t("tool.summary.runningCommand"),
        summarizeCommand(args),
      );
    case "run":
      return formatSummary(
        i18n.t("tool.summary.running"),
        getArgStr(args, "command") || getArgStr(args, "script"),
      );

    // ---- 任务与规划类 ----
    case "todo_write":
      return summarizeTodoWrite(args);
    case "plan":
      return formatSummary(
        i18n.t("tool.summary.planning"),
        getArgStr(args, "title") || getArgStr(args, "name"),
      );
    case "ask_user_question":
      return formatSummary(
        i18n.t("tool.summary.askingUser"),
        getArgStr(args, "question"),
      );
    case "save_conversation":
      return formatSummary(
        i18n.t("tool.summary.savingConversation"),
        getArgStr(args, "title") || getArgStr(args, "name"),
      );
    case "brief":
      return i18n.t("tool.summary.generatingConversationSummary");
    case "sessions":
      return formatSummary(
        i18n.t("tool.summary.managingSessions"),
        getArgStr(args, "action"),
      );

    // ---- 内容生成类 ----
    case "image_generate":
      return formatSummary(
        i18n.t("tool.summary.generatingImage"),
        getArgStr(args, "prompt"),
      );
    case "doc_generate":
      return formatSummary(
        i18n.t("tool.summary.generatingDoc"),
        getArgStr(args, "title"),
      );
    case "image":
      return formatSummary(
        i18n.t("tool.summary.editingImage"),
        getArgStr(args, "action"),
      );
    case "image_analysis":
      return formatSummary(
        i18n.t("tool.summary.analyzingImage"),
        getArgStr(args, "action") || getArgStr(args, "image_path", "path"),
      );
    case "image_svg_generate":
      return formatSummary(
        i18n.t("tool.summary.generatingSvg"),
        getArgStr(args, "prompt"),
      );
    case "image_display":
      return formatSummary(
        i18n.t("tool.summary.previewingImage"),
        getArgStr(args, "images"),
      );
    case "video_display":
      return formatSummary(
        i18n.t("tool.summary.previewingVideo"),
        getArgStr(args, "videos"),
      );
    case "audio_play":
      return formatSummary(
        i18n.t("tool.summary.playingAudio"),
        getArgStr(args, "audios"),
      );
    case "music_generate":
      return formatSummary(
        i18n.t("tool.summary.generatingMusic"),
        getArgStr(args, "prompt"),
      );
    case "video_generate":
      return formatSummary(
        i18n.t("tool.summary.generatingVideo"),
        getArgStr(args, "prompt"),
      );
    case "tts":
      return formatSummary(
        i18n.t("tool.summary.synthesizingVoice"),
        getArgStr(args, "text"),
      );
    case "canvas":
      return formatSummary(
        i18n.t("tool.summary.operatingCanvas"),
        getArgStr(args, "action"),
      );

    // ---- 系统工具类 ----
    case "clipboard":
      return formatSummary(
        i18n.t("tool.summary.operatingClipboard"),
        getArgStr(args, "action"),
      );
    case "computer_use":
      return formatSummary(
        i18n.t("tool.summary.simulatingAction"),
        getArgStr(args, "action"),
      );
    case "notebook":
      return formatSummary(
        i18n.t("tool.summary.editingNotebook"),
        getArgStr(args, "action"),
      );
    case "browser":
      return formatSummary(
        i18n.t("tool.summary.browsingWeb"),
        getArgStr(args, "url") || getArgStr(args, "action"),
      );
    case "agents_list":
      return formatSummary(
        i18n.t("tool.summary.viewingAgentList"),
        getArgStr(args, "type") || getArgStr(args, "status"),
      );
    case "cron_create":
      return formatSummary(
        i18n.t("tool.summary.creatingCronTask"),
        getArgStr(args, "name"),
      );
    case "channel":
    case "channel_manager":
    case "broadcast":
    case "gateway":
      return formatSummary(
        i18n.t("tool.summary.sendingMessage"),
        getArgStr(args, "content"),
      );

    // ---- 任务编排 ----
    case "create_task_list":
      return formatSummary(
        i18n.t("tool.summary.creatingTaskList"),
        getArgStr(args, "title"),
      );
    case "view_tasks":
    case "get_task_list":
      return i18n.t("tool.summary.viewingTaskList");
    case "abort_task":
    case "task_stop":
      return formatSummary(
        i18n.t("tool.summary.stoppingTask"),
        getArgStr(args, "task_id", "id"),
      );
    case "view_plan":
      return i18n.t("tool.summary.viewingPlan");
    case "update_task_status":
      return formatSummary(
        i18n.t("tool.summary.updatingTaskStatus"),
        getArgStr(args, "task_id", "id"),
      );
    case "task_output":
      return formatSummary(
        i18n.t("tool.summary.gettingTaskOutput"),
        getArgStr(args, "task_id", "id"),
      );

    // ---- MCP ----
    case "mcp_resource":
      return formatSummary(
        i18n.t("tool.summary.accessingMcpResource"),
        getArgStr(args, "resource", "name"),
      );

    // ---- 通用 ----
    case "fetch":
      return formatSummary(i18n.t("tool.summary.fetching"), summarizeUrl(args));
    case "list":
      return formatSummary(
        i18n.t("tool.summary.listing"),
        getArgStr(args, "path") || getArgStr(args, "type"),
      );
    case "query":
      return formatSummary(
        i18n.t("tool.summary.querying"),
        getArgStr(args, "query") || getArgStr(args, "sql"),
      );
    case "build_index":
      return formatSummary(
        i18n.t("tool.summary.buildingIndex"),
        getArgStr(args, "path") || getArgStr(args, "name"),
      );

    default:
      // 未知工具：显示工具名 + 第一个参数值
      const firstArg = Object.values(args)[0];
      const firstArgStr = typeof firstArg === "string" ? firstArg : "";
      if (firstArgStr) {
        return formatSummary(
          // #29（2026-10-30）：这里原先用**原始工具名**（`session_lookup`），与同行的
          // 中文显示名并排就出现「会话查询 session_lookup …」「任务管理 管理任务」重复；
          // 统一改用显示名，再由 `stripDuplicateToolPrefix` 去一次重。
          getToolDisplayName(name),
          firstArgStr.length > 30
            ? firstArgStr.slice(0, 30) + "..."
            : firstArgStr,
        );
      }
      return getToolDisplayName(name);
  }
}

/**
 * #29（2026-10-30）：去掉摘要里与标题**重复的前缀**（"任务管理 管理任务" → "管理任务"）。
 *
 * 折叠标题的两种版式都会把「显示名」和「人话摘要」并排：
 * `ToolCallGroup` 的 card 版式 = `displayName` + `summary`，inline 版式 = `summary || displayName`。
 * 未知工具走默认摘要分支时摘要以工具名开头 ⇒ 两段叠成重复词。此处按"显示名 + 分隔符"剥一层，
 * 只剥**完全匹配的前缀**，不改动摘要其余语义。
 */
export function stripDuplicateToolPrefix(
  displayName: string,
  summary: string,
): string {
  if (!displayName || !summary) return summary;
  if (!summary.startsWith(displayName)) return summary;
  const rest = summary.slice(displayName.length);
  // 允许的分隔符：空白 / 冒号 / 破折号（中英文）
  return rest.replace(/^[\s:：\-—–]+/, "");
}

/** 工具组聚合状态（#29：由**全部** tool_call 块推导，而非取第一块） */
export type ToolGroupStatus =
  | "completed"
  | "running"
  | "pending_approval"
  | "failed";

/**
 * #29（2026-10-30）：工具组状态 = 全组聚合，不再"取第一条调用的状态"。
 *
 * 真机症状：已完成的组仍显示「正在执行命令」/ 组头是 ✅ 但文案是进行中 / 已完成消息下
 * 还挂着「⏳ 等待审批」。根因是原实现 `for (block) return block.toolCall.status` 只看第一块。
 *
 * 口径（自上而下短路）：有**正在执行** ⇒ running；否则有**待审批** ⇒ pending_approval；
 * 否则有**失败** ⇒ failed；否则 completed。
 */
export function resolveGroupStatus(
  blocks: ReadonlyArray<{
    type: string;
    isStreaming?: boolean;
    toolCall?: { status?: string; pendingApproval?: boolean };
  }>,
): ToolGroupStatus {
  let hasTool = false;
  let anyRunning = false;
  let anyPending = false;
  let anyFailed = false;

  for (const block of blocks) {
    if (block.type !== "tool_call") continue;
    hasTool = true;
    const tc = block.toolCall;
    if (tc?.status === "running" || block.isStreaming) anyRunning = true;
    if (tc?.pendingApproval) anyPending = true;
    if (tc?.status === "failed") anyFailed = true;
  }

  if (anyRunning) return "running";
  if (anyPending) return "pending_approval";
  if (anyFailed) return "failed";
  if (hasTool) return "completed";
  return blocks.some((b) => b.isStreaming) ? "running" : "completed";
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
  return detail
    ? `${action}${i18n.t("tool.summary.separator")}${detail}`
    : action;
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
    if (size < 1024) {
      return ` (${i18n.t("tool.value.chars", { value: size })})`;
    }
    if (size < 1024 * 1024) return ` (${(size / 1024).toFixed(1)} KB)`;
    return ` (${(size / 1024 / 1024).toFixed(1)} MB)`;
  }
  if (typeof content === "string") {
    return ` (${i18n.t("tool.value.chars", { value: content.length })})`;
  }
  return "";
}

/** 摘要 todo_write：区分创建/更新/标记完成 */
function summarizeTodoWrite(args: Record<string, unknown>): string {
  const action = getArgStr(args, "action");
  const todos = args["todos"] as Array<Record<string, unknown>> | undefined;

  switch (action) {
    case "create":
      if (Array.isArray(todos) && todos.length > 0) {
        // P3-4：getArgStr 内置 typeof string 守卫，避免 unknown 类型拼出 [object Object]
        const names = todos.map((t) => getArgStr(t, "content")).filter(Boolean);
        const joined = names
          .slice(0, 3)
          .join(i18n.t("tool.summary.listSeparator"));
        return names.length > 3
          ? i18n.t("tool.summary.todoCreatedMore", {
              total: todos.length,
              names: joined,
            })
          : i18n.t("tool.summary.todoCreated", {
              total: todos.length,
              names: joined,
            });
      }
      return i18n.t("tool.summary.todoCreate");
    case "update":
      if (Array.isArray(todos) && todos.length > 0) {
        const first = todos[0];
        const status = first["status"];
        if (status === "completed")
          return i18n.t("tool.summary.todoCompleted", {
            name: getArgStr(first, "content"),
          });
        if (status === "in_progress")
          return i18n.t("tool.summary.todoStarted", {
            name: getArgStr(first, "content"),
          });
        return i18n.t("tool.summary.todoUpdated", {
          name: getArgStr(first, "content"),
        });
      }
      return i18n.t("tool.summary.todoUpdateStatus");
    case "complete":
      return i18n.t("tool.summary.todoCompleted", {
        name: getArgStr(args, "id") || getArgStr(args, "name"),
      });
    default:
      return i18n.t("tool.summary.todoManage");
  }
}

// ============================================================
// 工具调用参数键名 → 中文显示名映射
// ============================================================

/** 参数键名 → i18n 显示名键（tool.argKey.<键名>） */
const ARG_KEY_LABEL_MAP: Record<string, string> = {
  file_path: "tool.argKey.file_path",
  url: "tool.argKey.url",
  query: "tool.argKey.query",
  pattern: "tool.argKey.pattern",
  command: "tool.argKey.command",
  path: "tool.argKey.path",
  keywords: "tool.argKey.keywords",
  code: "tool.argKey.code",
  language: "tool.argKey.language",
  content: "tool.argKey.content",
  output: "tool.argKey.output",
};

/**
 * 获取参数键名的中文显示名
 */
export function getArgKeyLabel(key: string): string {
  const i18nKey = ARG_KEY_LABEL_MAP[key];
  return i18nKey ? i18n.t(i18nKey) : key;
}
