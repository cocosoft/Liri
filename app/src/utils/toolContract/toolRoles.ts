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
