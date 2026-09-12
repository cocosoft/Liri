/**
 * 工具名称常量（**运行期实际注册名**）
 *
 * O27 修复（2026-09-12）：本文件原有一批 Claude Code 风格的大写常量
 * （`BASH_TOOL_NAME = 'Bash'` / `FILE_READ_TOOL_NAME = 'Read'` / `SHELL_TOOL_NAMES = ['Bash']` …），
 * 与运行时实际注册名（`bash` / `file_read` / `file_write` …）**不一致** ——
 * 照它写判定必然永不命中。已知受害者：
 *   - `PermissionChecker` 的 `toolName === 'Bash'` / `'File'` 分支（永不命中，死代码）
 *   - `ToolExecutionService` 的 `name === FILE_WRITE_TOOL_NAME` 回滚追踪（永不命中，追踪失效）
 * 工具名的事实来源是各工具类的 `name` 字段（即 `ToolRegistry` 的注册名，小写）。
 *
 * 本文件只保留跨模块（permission / sandbox / query / tools / chat）共用的**真实名**常量与判定，
 * 其余零引用的旧常量已删除，避免同一名单被复制成多份后各自漂移。
 */

/** 文件写入工具（实际注册名 `file_write`）*/
export const FILE_WRITE_TOOL_NAME = 'file_write';

/** 文件编辑工具（实际注册名 `file_edit`）*/
export const FILE_EDIT_TOOL_NAME = 'file_edit';

/** 项目文件写入工具（实际注册名 `write_project_file`）*/
export const PROJECT_FILE_WRITE_TOOL_NAME = 'write_project_file';

/** 写类文件工具 —— 危险文件守卫（.bashrc/.mcp.json 等）按写语义判定 */
export const FILE_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  FILE_WRITE_TOOL_NAME,
  FILE_EDIT_TOOL_NAME,
  PROJECT_FILE_WRITE_TOOL_NAME,
]);

/** 是否写类文件工具（大小写无关） */
export function isFileWriteToolName(name: string): boolean {
  return FILE_WRITE_TOOL_NAMES.has(name.toLowerCase());
}

/** 实际注册的 shell 类工具名（小写，对齐 ToolRegistry 注册名） */
export const REGISTERED_SHELL_TOOL_NAMES = [
  'bash',
  'shell',
  'command',
  'powershell',
] as const;

/**
 * 是否 shell 类工具（大小写无关）—— 权限 / 沙箱 / 路径守卫共用的**唯一**判定入口
 */
export function isShellToolName(name: string): boolean {
  return (REGISTERED_SHELL_TOOL_NAMES as readonly string[]).includes(
    name.toLowerCase()
  );
}

/**
 * 路径类参数名（**规范清单**，跨模块共用）
 *
 * 原分散在 `query/PathGuard.ts`（拒绝列表判定）与 permission 侧（危险文件判定）——
 * 收敛到此处避免各写一份后漂移（O26 的根因就是参数名白名单与实际不一致）。
 */
export const PATH_ARG_KEYS: ReadonlySet<string> = new Set([
  'path',
  'file_path',
  'filePath',
  'filePaths',
  'relativePath',
  'searchPath',
  'directory',
  'target_directory',
  'notebook_path',
  'inputPath',
  'outputPath',
  'comparePath',
  'videoPath',
  'imagePath',
  'savePath',
  'saveToFile',
  'content_file',
  'source_file',
  'workingDirectory',
  'docPath',
  'targetDir',
  'filename',
]);

/** 名字含 path/file 但**不是**文件系统路径的参数（键形启发式的显式豁免） */
export const NON_PATH_ARG_KEYS: ReadonlySet<string> = new Set([
  'file_id',
  'direction',
]);

/** 参数名"像路径"的形状 —— 动态注册工具（MCP/插件）无法枚举，以此兜底 */
const PATH_ARG_KEY_SHAPE = /path|file|dir/i;

/**
 * 判断参数名是否为路径类
 *
 * 判定顺序：显式豁免 → 规范清单 → 键形启发式。**不能只靠清单** ——
 * MCP/插件等动态注册工具的路径参数名不可能都预先登记（O28② 实测 `{targetFile}` 会漏）。
 */
export function isPathArgKey(key: string): boolean {
  if (NON_PATH_ARG_KEYS.has(key)) return false;
  if (PATH_ARG_KEYS.has(key)) return true;
  return PATH_ARG_KEY_SHAPE.test(key);
}

/**
 * 从工具参数中提取全部路径值（兼容字符串与字符串数组）
 *
 * 供 PathGuard（拒绝列表判定）与 PermissionChecker（危险文件/目录判定）共用。
 */
export function extractPathArgs(args: Record<string, unknown>): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(args ?? {})) {
    if (!isPathArgKey(key)) continue;
    if (typeof value === 'string') {
      if (value) paths.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item) paths.push(item);
      }
    }
  }
  return paths;
}
