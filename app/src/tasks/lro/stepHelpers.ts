// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * stepHelpers —— 步骤执行的纯函数助手（LRO 拆分批 U-22/S2b）
 *
 * **来源**：从 `LongRunningTaskOrchestrator.ts` 外移 `isSecurityIntercepted` /
 * `MAX_SECURITY_STEERS_PER_STEP` / `buildSecuritySteeringMessage` /
 * `classifyArtifactAccess` / `buildTaorStepResult`。
 *
 * **为什么外移**：`executeSingleStep` 迁往 `./stepExecution` 后仍需这 5 个符号；
 * 若从宿主 import 会形成 `stepExecution → 宿主 → stepExecution` 循环依赖 ⇒ 先落到本模块。
 * 宿主对前 4 个公开符号**re-export**，既有导入路径（测试）零改动。
 *
 * **行为等价**：判定口径（只认显式布尔标记）/ 文案 / 分类规则 / 摘要格式逐字未变。
 */

import { getToolCategory } from '../../tools/index.js';

/**
 * 安全策略拦截的**显式标记**判定（2026-10-08）。
 *
 * 各工具的拦截分支（`security_analyzer_deny` / `security_analyzer_ask` /
 * `command_whitelist` / `ast_analysis` / `COMMAND_NOT_ALLOWED`）统一写
 * `metadata.securityIntercepted: true` ⇒ 本函数**只认这一布尔标记**，不做错误文案匹配
 * （CS02：状态判定禁止字符串匹配）。
 */
export function isSecurityIntercepted(result: unknown): boolean {
  const meta = (
    result as
      | { metadata?: { securityIntercepted?: boolean } }
      | null
      | undefined
  )?.metadata;
  return meta?.securityIntercepted === true;
}

/** 每步最多注入多少次"改道"steering（防 runaway；拦截本身已被安全层硬拒，不会执行） */
export const MAX_SECURITY_STEERS_PER_STEP = 2;

/**
 * 构造"改道"steering 文案（被安全策略拦截后注入，令模型**下一轮**改用专用工具）。
 *
 * 约束（与 `TAORLoop.injectSteering` 的 `_steeringFilter` 对齐）：长度 < 2000，
 * 且不得包含 `system:` / `<|im_start|>`（否则被过滤器整条拒收）。前缀由骨架的
 * `steering` 片段渲染给出 ⇒ **此处不再手写 `[STEERING]`**（避免双轨）。
 */
export function buildSecuritySteeringMessage(
  blockedToolNames: readonly string[]
): string {
  const names = [...new Set(blockedToolNames)].join('、');
  return (
    `上一次工具调用被**安全策略拦截**（${names}）：本仓对 shell 管道（|）、重定向（> >>）、` +
    '命令连接（&& ; ）与 .NET 直调（如 [System.IO.File]::WriteAllText）**一律拒绝**。\n' +
    '请**立即改道**，不要重复同类命令形式：文件读写/编辑用 `file_write` / `file_read` / `file_edit`，' +
    '路径查找用 `glob`，内容检索用 `grep`。\n' +
    '若本步要求产出文件：直接用 `file_write` 写入，随后用 `file_read` 读回内容作为验收证据。'
  );
}

/**
 * 步骤执行结果摘要 —— REVIEW 的唯一"实际输出"输入（`buildReviewPrompt` 取 `step.result`）。
 * **2026-10-08（真机实测暴露）**：原先 `markStepCompleted` 只写
 * `[TAORLoop] turns=… tokens=… elapsed=…ms` —— 只有**循环统计**、零执行证据 ⇒ Reviewer
 * 只能判"无任何证据"⇒ 每步 failed ⇒ `PDCA_GOAL_NOT_CONVERGED`
 * （实测：工具已真实执行、目标文件确实生成，任务仍报未收敛）。
 * 现把**助手文本 + 工具执行结果**一并写入。
 *
 * @param messages 本轮**最终**消息快照（TAORLoop 每轮传全量 `this.messages`）
 */
export function buildTaorStepResult(
  messages: ReadonlyArray<{
    role?: string;
    name?: string;
    content?: unknown;
  }>,
  stats: { turns: number; tokens: number; elapsedMs: number }
): string {
  const MAX_MSG_CHARS = 800;
  const LRO_MAX_MESSAGES = 12;
  const lines: string[] = [
    `[TAORLoop] turns=${stats.turns} tokens=${stats.tokens} elapsed=${stats.elapsedMs}ms`,
  ];
  for (const m of messages.slice(-LRO_MAX_MESSAGES)) {
    const text =
      typeof m.content === 'string'
        ? m.content
        : m.content === undefined || m.content === null
          ? ''
          : JSON.stringify(m.content);
    if (!text) continue;
    const role = m.name
      ? `${m.role ?? 'assistant'}:${m.name}`
      : (m.role ?? 'assistant');
    lines.push(`[${role}] ${text.slice(0, MAX_MSG_CHARS)}`);
  }
  return lines.join('\n');
}

/** 一步内某次工具调用对「产物」的读写意图（机械保障：写后读回用） */
export interface ArtifactAccess {
  kind: 'write' | 'read';
  path: string;
}

/**
 * 从工具调用推断其对产物的读写意图（纯函数，可单测）。
 *
 * 分类**不手写工具名**，直接复用 `TOOL_CATEGORIES` 的既有口径：
 * `'file'` = 写/改类（`file_write` / `file_edit` / `file_convert` / `write_project_file`），
 * `'file_read'` = 只读类（`file_read` / `glob` / `read_project_file`）。新增工具只要类别登记正确即自动纳入。
 *
 * 路径取 `file_path`（本仓写/读类工具的统一参数名），兼容常见别名 `path`。
 */
export function classifyArtifactAccess(
  toolName: string,
  args: Record<string, unknown> | undefined
): ArtifactAccess | undefined {
  const category = getToolCategory(toolName);
  const kind: ArtifactAccess['kind'] | undefined =
    category === 'file'
      ? 'write'
      : category === 'file_read'
        ? 'read'
        : undefined;
  if (!kind) return undefined;
  const raw =
    typeof args?.file_path === 'string'
      ? args.file_path
      : typeof args?.path === 'string'
        ? args.path
        : undefined;
  const path = raw?.trim();
  if (!path) return undefined;
  return { kind, path };
}
