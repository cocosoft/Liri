/**
 * 过程组语义统计（2026-11-24，前端任务面板治理 · 批次 1）。
 *
 * 背景（真机会话 `session_mwq5ookl21aa28ea96`）：过程组头显示「N 步 / N 个工具调用 / N 次思考」，
 * 与用户真正关心的工作量（改了哪些文件、读了多少文件、搜了几次、跑了几条命令）脱节。
 *
 * 口径（结构化，不做文案匹配）：
 * - 编辑/读取按**去重后的文件路径**计数（同一文件多次操作只算 1 个）；
 * - 搜索/命令按**调用次数**计数；
 * - 无路径参数时回退为按调用 id 去重（不虚增、也不丢调用）。
 */

/** 统计结果（零值段在展示层省略） */
export interface ProcessToolStats {
  /** 被修改/写入的文件数（去重路径） */
  editedFiles: number;
  /** 被读取的文件数（去重路径） */
  readFiles: number;
  /** 搜索类调用次数（grep / glob / web_search …） */
  searches: number;
  /** shell 命令调用次数（bash / powershell …） */
  commands: number;
  /** 其余工具调用次数 */
  other: number;
}

/** 统计输入的最小结构（`MessageBlock` 的 `tool_call` 子集） */
export interface ProcessToolCallLike {
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
}

/** 写入/编辑类工具（与后端 `toolCategories.ts` 的 `file` 类同源命名；此处只用于展示统计） */
const EDIT_TOOLS = new Set([
  "file_write",
  "file_edit",
  "write_file",
  "edit_file",
  "write_project_file",
  "apply_patch",
]);

/** 只读文件类工具 */
const READ_TOOLS = new Set(["file_read", "read_file", "read_project_file"]);

/** 搜索类工具 */
const SEARCH_TOOLS = new Set(["grep", "glob", "web_search", "search_files"]);

/** 终端命令类工具 */
const COMMAND_TOOLS = new Set([
  "bash",
  "powershell",
  "tungsten",
  "shell",
  "cmd",
]);

/** 路径参数候选键（不同工具命名不一致；只取结构化字段） */
const PATH_KEYS = ["file_path", "path", "file", "target_file"] as const;

function resolvePath(tc: ProcessToolCallLike): string | undefined {
  const args = tc.arguments;
  if (!args) return undefined;
  for (const key of PATH_KEYS) {
    const value = args[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

/**
 * 汇总一组工具调用的语义统计。
 *
 * @param calls 工具调用（顺序无关；同一调用的重复项按 id 去重）
 */
export function summarizeProcessTools(
  calls: ReadonlyArray<ProcessToolCallLike | undefined>,
): ProcessToolStats {
  const edited = new Set<string>();
  const read = new Set<string>();
  let searches = 0;
  let commands = 0;
  let other = 0;

  for (const tc of calls) {
    if (!tc) continue;
    const name = tc.name ?? "";
    // 回退标识：无路径时用调用 id（仍为去重口径）；id 缺失则用序号式唯一键
    const fallbackId = tc.id ?? `${name}:${edited.size + read.size + other}`;
    if (EDIT_TOOLS.has(name)) {
      edited.add(resolvePath(tc) ?? fallbackId);
    } else if (READ_TOOLS.has(name)) {
      read.add(resolvePath(tc) ?? fallbackId);
    } else if (SEARCH_TOOLS.has(name)) {
      searches++;
    } else if (COMMAND_TOOLS.has(name)) {
      commands++;
    } else {
      other++;
    }
  }

  return {
    editedFiles: edited.size,
    readFiles: read.size,
    searches,
    commands,
    other,
  };
}

/** 是否有任何语义统计可展示（否则展示层回退到旧口径） */
export function hasProcessStats(stats: ProcessToolStats): boolean {
  return (
    stats.editedFiles > 0 ||
    stats.readFiles > 0 ||
    stats.searches > 0 ||
    stats.commands > 0
  );
}
