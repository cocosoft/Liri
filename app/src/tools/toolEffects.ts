// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * toolEffects — 工具**副作用与幂等性**声明（13-P1-2，2026-10-05）
 *
 * 背景：《Agentic Design Patterns》21 模式复查 §13 A3 —— 全仓 `idempotent|sideEffect`
 * 命中**全在无关域**（`AgentRunLedger`/`rollback`/`SettlementOutbox`），**工具注册表无幂等声明**
 * ⇒ 非幂等工具被（模型或代码）重试时可能产生**重复副作用**。
 *
 * 设计：
 * - **唯一事实源**：`TOOL_EFFECTS: Record<ToolName, ToolEffect>` —— 键取自
 *   `constants/toolNames.generated.ts` 的编译期联合 ⇒ **漏声明 / 拼错名 ⇒ `typecheck` 失败**
 *   （比运行时测试更强的守卫）。
 * - **声明依据（取证）**：2026-10-05 以脚本对全部内置工具实测其自带元数据
 *   （`BaseTool.isReadOnly()` / `isDestructive()`，见本节末「取证口径」），据此得出：
 *   ① `readOnly === true` ⇒ `{ idempotent: true, sideEffect: 'none' }`；
 *   ② **可重放无害**类（等待/展示/播放/只读分析）⇒ 同上（显式列出，不靠猜测）；
 *   ③ **对外部系统有可见影响**类 ⇒ `{ idempotent: false, sideEffect: 'external' }`；
 *   ④ 其余（本地状态变更）⇒ `{ idempotent: false, sideEffect: 'local' }`。
 * - **重试策略输入**：`shouldBlindRetryTool()` —— 非幂等工具**不得盲目重试**（改为询问/补偿）。
 *
 * 取证口径：临时脚本遍历 `getAllBuiltinToolLoaders()`，对每个工具调用
 * `isReadOnly({})` / `isDestructive()` 取真实返回值（脚本已删除，结论固化于下表）。
 */

import type { ToolName } from '../constants/toolNames.generated';

/** 副作用范围：`none` 无副作用 · `local` 本地状态 · `external` 对外部系统/用户可见 */
export type ToolSideEffect = 'none' | 'local' | 'external';

/** 工具效果声明 */
export interface ToolEffect {
  /** 重复调用（含并发）是否与单次等价 */
  idempotent: boolean;
  /** 副作用范围 */
  sideEffect: ToolSideEffect;
}

const NONE: ToolEffect = { idempotent: true, sideEffect: 'none' };
const LOCAL: ToolEffect = { idempotent: false, sideEffect: 'local' };
const EXTERNAL: ToolEffect = { idempotent: false, sideEffect: 'external' };

/**
 * 内建工具效果声明（**唯一事实源**；`Record<ToolName, …>` ⇒ 漏声明编译失败）。
 *
 * ⚠️ 新增内置工具时必须在此显式声明（typecheck 会强制）。
 */
export const TOOL_EFFECTS: Record<ToolName, ToolEffect> = {
  agent: EXTERNAL,
  ask_user_question: EXTERNAL,
  audio_play: NONE,
  bash: EXTERNAL,
  brief: LOCAL,
  broadcast: EXTERNAL,
  browser: EXTERNAL,
  browser_vision: EXTERNAL,
  canvas: LOCAL,
  channel: EXTERNAL,
  clipboard: LOCAL,
  code_run: EXTERNAL,
  computer_use: EXTERNAL,
  config: LOCAL,
  create_project: LOCAL,
  create_task_list: LOCAL,
  cron_create: LOCAL,
  cron_delete: LOCAL,
  cron_list: NONE,
  cron_stop: LOCAL,
  doc_generate: LOCAL,
  enter_worktree: LOCAL,
  exit_worktree: LOCAL,
  file_convert: NONE,
  file_edit: LOCAL,
  file_read: NONE,
  file_write: LOCAL,
  get_task_list: NONE,
  glob: NONE,
  grep: NONE,
  image: LOCAL,
  image_analysis: NONE,
  image_display: NONE,
  image_generate: LOCAL,
  image_svg_generate: LOCAL,
  knowledge_save: LOCAL,
  list_peers: NONE,
  list_vfs: NONE,
  lsp: LOCAL,
  mcp_resource: NONE,
  mcp_tool: EXTERNAL,
  monitor: LOCAL,
  music: LOCAL,
  notebook: LOCAL,
  plan: LOCAL,
  powershell: EXTERNAL,
  read_project_file: NONE,
  read_vfs: NONE,
  repl: LOCAL,
  save_conversation: LOCAL,
  sessions: LOCAL,
  sessions_yield: LOCAL,
  skill: LOCAL,
  skill_view: NONE,
  skills_list: NONE,
  sleep: NONE,
  sleep_for: NONE,
  sleep_until: NONE,
  stat_vfs: NONE,
  task_stop: LOCAL,
  todo_write: LOCAL,
  tool_search: NONE,
  trace_recording: NONE,
  tungsten: LOCAL,
  update_task_status: LOCAL,
  video: LOCAL,
  video_analysis: NONE,
  video_display: NONE,
  video_generate: LOCAL,
  web_fetch: NONE,
  web_search: NONE,
  write_project_file: LOCAL,
  write_vfs: LOCAL,
};

/** 取工具效果声明；未声明（MCP / 插件等外部工具）⇒ `undefined` */
export function resolveToolEffect(name: string): ToolEffect | undefined {
  return TOOL_EFFECTS[name as ToolName];
}

/**
 * **重试策略输入**（13-P1-2）：是否允许对该工具"盲目重试"。
 *
 * - 已声明且 `idempotent === true` ⇒ 允许；
 * - 已声明但非幂等 ⇒ **禁止**（调用方应改为"询问用户 / 补偿"）；
 * - **未声明**（MCP/插件工具）⇒ **禁止**（保守：无法证明幂等即不重试）。
 */
export function shouldBlindRetryTool(name: string): boolean {
  return resolveToolEffect(name)?.idempotent === true;
}

/** 供门禁/测试断言的声明总数（漂移守护：只增不减，新增工具必须显式声明） */
export const TOOL_EFFECTS_COUNT = Object.keys(TOOL_EFFECTS).length;

/** 一次**已发生**的工具调用（判定「重试」所需的最小历史；由调用方提供） */
export interface PriorToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
  /** 上次该调用的失败原因；缺省/空 ⇒ 视为成功 */
  error?: string;
}

/** 递归深比较（**键序无关**，数组按下标）—— 仅供本文件的参数比对，不引跨层工具 */
function deepEqualArgs(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((v, i) => deepEqualArgs(v, (b as unknown[])[i]));
  }
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k, i) =>
      k === kb[i] &&
      deepEqualArgs(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[kb[i]]
      )
  );
}

/**
 * 是否为**非幂等工具的「重试」**（R07-3，2026-10-07）
 *
 * 与 `shouldBlindRetryTool()` 同源（同取 `resolveToolEffect`），区别是这里回答的是
 * **"这一次调用是不是在重放已失败的那一次"**，供执行前**主动分流**（升级为审批）使用。
 *
 * 判据（spec `non-idempotent-retry-approval.md` **D1**）：
 * **同工具名 + 同参数 + 上次失败** —— 精确表达"原样重放"，与「换参数再试」（合法）区分开。
 *
 * - 幂等（`shouldBlindRetryTool(name) === true`）⇒ **不是重试**（可自动重试）；
 * - **未声明**工具（MCP / 插件）⇒ 按 **D3** 保守纳入（与 `shouldBlindRetryTool` 同口径）；
 * - 历史由调用方提供（`toolResultRegistry.listBySession`）⇒ **纯函数、可单测**。
 */
export function isNonIdempotentRetry(
  name: string,
  args: Record<string, unknown>,
  history: readonly PriorToolCall[]
): boolean {
  if (shouldBlindRetryTool(name)) return false; // 幂等 ⇒ 允许自动重试
  return history.some(
    (c) =>
      c.toolName === name &&
      Boolean(c.error) &&
      deepEqualArgs(c.arguments, args)
  );
}
