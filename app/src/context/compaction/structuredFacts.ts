/**
 * structuredFacts — 折叠批的**结构化事实兜底**（P1-2，2026-11-04）
 *
 * 背景（《运行态问题排查与修复方案》P1-2）：Tier3 折叠在低保留场景（实测
 * `ratio 0.007`，2172 → 16）会把整批历史压成极短摘要，**文件路径 / 命令**这类
 * 可复用的硬事实最先丢失，长会话随后只能靠"重新探索"补回来。
 *
 * 本模块**确定性**地抽取两类硬事实，并在该批保留度不达标时原样附在摘要后：
 * - 路径：`tool_calls.function.arguments` 中命中 {@link PATH_ARG_KEYS} 的字符串入参；
 * - 命令：shell 类工具的 `command` / `script` 入参。
 *
 * 为什么不做"结论抽取"：结论需要语义判断，正则/关键词只会产出一份看似结构化、
 * 实则不可信的表（违反 CS02「不靠文案猜语义」）⇒ 本模块只保留**机器可判定**的事实。
 *
 * 纯函数、无 I/O、无 LLM 调用；上限由常量固定（防摘要被事实块反超）。
 */

import type { ChatMessage } from '@modules/ai';
import { PATH_ARG_KEYS } from '@openliri/infra/utils/toolContract/pathArgs';

/** 单个事实值的最大字符数（超出截断并加省略号） */
export const STRUCTURED_FACT_VALUE_MAX_CHARS = 200;
/** 最多保留的路径条数 */
export const STRUCTURED_FACTS_MAX_PATHS = 12;
/** 最多保留的命令条数 */
export const STRUCTURED_FACTS_MAX_COMMANDS = 8;

/** shell 类工具名（与 `chatModePolicy` 的"执行类"同一集合口径） */
const SHELL_TOOL_NAMES: ReadonlySet<string> = new Set([
  'bash',
  'shell',
  'command',
  'powershell',
  'code_run',
]);

/** 命令类入参键（不同工具的命名差异） */
const COMMAND_ARG_KEYS: readonly string[] = ['command', 'script', 'cmd'];

export interface StructuredFacts {
  /** 出现过的工作路径（按首次出现顺序，去重） */
  paths: string[];
  /** 执行过的命令（截断，按首次出现顺序，去重） */
  commands: string[];
}

function truncate(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > STRUCTURED_FACT_VALUE_MAX_CHARS
    ? `${trimmed.slice(0, STRUCTURED_FACT_VALUE_MAX_CHARS)}…`
    : trimmed;
}

function pushUnique(list: string[], seen: Set<string>, value: unknown): void {
  if (typeof value !== 'string' || !value.trim()) return;
  const normalized = truncate(value);
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  list.push(normalized);
}

/** 解析 tool_call 的 arguments（非法 JSON ⇒ null，不臆造） */
function parseArgs(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    // @ignore-catch — 参数不是合法 JSON（流式截断/非标准工具）⇒ 跳过该调用的抽取
    return null;
  }
}

/**
 * 从一个折叠批中抽取结构化事实。
 *
 * 只读 `tool_calls`（结构化字段），不解析自由文本 —— 避免把提示词里的
 * "像路径的字符串"当成事实（CS02）。
 */
export function extractStructuredFacts(
  messages: readonly ChatMessage[]
): StructuredFacts {
  const paths: string[] = [];
  const seenPaths = new Set<string>();
  const commands: string[] = [];
  const seenCommands = new Set<string>();

  for (const message of messages) {
    const calls = message.tool_calls;
    if (!Array.isArray(calls)) continue;
    for (const call of calls) {
      const name = call?.function?.name ?? '';
      const args = parseArgs(call?.function?.arguments ?? '');
      if (!args) continue;
      // 路径：命中路径语义键的入参（单一事实源 `PATH_ARG_KEYS`）
      for (const key of PATH_ARG_KEYS) {
        if (paths.length >= STRUCTURED_FACTS_MAX_PATHS) break;
        pushUnique(paths, seenPaths, args[key]);
      }
      // 命令：仅 shell 类工具，且取命令类入参
      const toolName = name.toLowerCase();
      if (!SHELL_TOOL_NAMES.has(toolName)) continue;
      for (const key of COMMAND_ARG_KEYS) {
        if (commands.length >= STRUCTURED_FACTS_MAX_COMMANDS) break;
        pushUnique(commands, seenCommands, args[key]);
      }
    }
  }

  return {
    paths: paths.slice(0, STRUCTURED_FACTS_MAX_PATHS),
    commands: commands.slice(0, STRUCTURED_FACTS_MAX_COMMANDS),
  };
}

/** 事实是否为空（空 ⇒ 调用方不追加任何内容，保持摘要逐字不变） */
export function hasStructuredFacts(facts: StructuredFacts): boolean {
  return facts.paths.length > 0 || facts.commands.length > 0;
}

/**
 * 渲染事实块（Markdown 片段）。空事实 ⇒ 空字符串（调用方据此跳过追加）。
 *
 * 标题刻意标注"压缩时原样保留"，让模型知道这是**事实**而非上一轮的摘要结论。
 *
 * @param options.alreadyPresentIn 摘要原文：其中**已出现**的事实不再重复追加
 *   （低保留判定基于"文本实体"，摘要可能已保留部分路径 ⇒ 只补缺的那些）
 */
export function renderStructuredFactsBlock(
  facts: StructuredFacts,
  options: { alreadyPresentIn?: string } = {}
): string {
  const haystack = options.alreadyPresentIn ?? '';
  const keep = (value: string): boolean =>
    haystack.length === 0 || !haystack.includes(value);
  const paths = facts.paths.filter(keep);
  const commands = facts.commands.filter(keep);
  if (paths.length === 0 && commands.length === 0) return '';
  const lines: string[] = ['【结构化事实（压缩时原样保留）】'];
  if (paths.length > 0) {
    lines.push('涉及路径：');
    for (const path of paths) lines.push(`- ${path}`);
  }
  if (commands.length > 0) {
    lines.push('执行过的命令：');
    for (const command of commands) lines.push(`- ${command}`);
  }
  return lines.join('\n');
}
