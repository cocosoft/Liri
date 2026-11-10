/**
 * 工具**角色**声明（A-4，2026-10-18）—— 名称级判据的**单一来源**。
 *
 * ## 为什么还需要名称集合（而不全走 `sandboxLevel`）
 * 能力枚举只有 `read / write-local / write-external / execute`，无法区分
 * 「命令执行 / 文件写 / 媒体产物」这类**同能力、不同语义**的分支；而权限层与会话回灌层
 * 只拿得到**名字**（没有工具实例）。
 * ⇒ 把这些「名字 → 角色」的判据集中在此，**禁止**在调用点再写
 * `toolName === 'bash'` 等散落字面量。
 *
 * ## 与 `tools/toolNameConstants.ts` 的分工
 * 那里是**真实注册名的事实源**；本文件是**角色归类**（含历史别名
 * `shell` / `command` / `write_to_file` / `replace_in_file` —— 它们不是注册名，故不并入常量表）。
 *
 * 置于 `utils`（infra）：`permission`（infra）/ `infrastructure`（service）/ `session`（app）都要用，
 * 放在 `tools`（app）会造成 `service → app` 分层倒挂（R00-001）。
 */

const SHELL_TOOL_NAMES: ReadonlySet<string> = new Set([
  'bash',
  'shell',
  'command',
]);

/** 是否为 shell/命令类工具（含权限规则里的历史别名） */
export function isShellToolName(name: string): boolean {
  return SHELL_TOOL_NAMES.has(name);
}

/**
 * P1（2026-11-07，真机反馈「只有 bash 接了，其它命令呢」）：带**命令文本**的命令类工具。
 *
 * 与 `isShellToolName()` 的区别与分工：
 * - `isShellToolName()` = 权限层的**历史口径**（bash/shell/command），被放行缓存、
 *   意图偏差等路径消费，语义保持不动；
 * - 本集合额外包含 `powershell` / `pwsh`（入参同样是 `command` 文本），用于：
 *   ① 审批卡是否给出「命令级 / 工具级」放行档（`toolApprovalSubmission`）；
 *   ② L2「自定义规则 → 命令黑名单/白名单」是否对它的 `command` 生效
 *      （`PermissionChecker` / `PermissionManager`）。
 *
 * 之前只认 bash：PowerShell 工具既拿不到命令级放行档，设置里的命令黑名单/白名单也管不到它。
 */
const COMMAND_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...SHELL_TOOL_NAMES,
  'powershell',
  'pwsh',
]);

/** 是否为「入参含 command 文本」的命令类工具（审批档位 / 命令级规则用） */
export function isCommandToolName(name: string): boolean {
  return COMMAND_TOOL_NAMES.has(name);
}

/**
 * 入参是要被**执行**的代码文本的工具（2026-11-10）。
 *
 * 与 `isCommandToolName` 的分工：那个是"入参键叫 command"的 shell 类；本集合补
 * **代码执行**工具（`code` 工具的入参是 `code`），供分类器决定"注入类检测要扫谁"。
 */
const CODE_EXEC_TOOL_NAMES: ReadonlySet<string> = new Set(['code']);

/**
 * 是否为「入参会被执行」的工具（命令 / 代码）。
 *
 * 分类器的命令注入 / 危险令牌 / 编码 / XSS 等检测**只应对执行面生效** —— 对
 * `todo_write` 的待办正文、`grep` 的正则、`file_write` 的文件内容扫描只会误杀
 * （真机 2026-11-10：`todo_write` 因 `"id "`、`file_write` 因 `at ` / `</script>`
 * 被拒 ⇒ `environment_blocked`）。
 */
export function isExecutionToolName(name: string): boolean {
  return COMMAND_TOOL_NAMES.has(name) || CODE_EXEC_TOOL_NAMES.has(name);
}

const FILE_WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'file_write',
  'file_edit',
  'write_to_file',
  'replace_in_file',
]);

/** 是否为文件写类工具（含旧版命名；用于会话状态回灌判定） */
export function isFileWriteToolName(name: string): boolean {
  return FILE_WRITE_TOOL_NAMES.has(name);
}

const MEDIA_OUTPUT_TOOL_NAMES: ReadonlySet<string> = new Set([
  'image_generate',
  'image_display',
  'video_display',
  'audio_play',
]);

/** 是否为"向用户交付媒体产物"类工具（SSE 转发 / 渲染判定） */
export function isMediaOutputToolName(name: string): boolean {
  return MEDIA_OUTPUT_TOOL_NAMES.has(name);
}
