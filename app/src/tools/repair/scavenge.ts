// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * 工具调用回收 (Scavenge)
 *
 * R1 模型有时会在 reasoning_content 中泄漏 JSON 格式的工具调用，
 * 同时忘记在 tool_calls 字段中声明。本模块从 thinking 块中回收这些调用。
 *
 * 支持三种模式:
 *   A. DSML invoke 块
 *   B. 独立 JSON 对象（OpenAI 格式 / R1 自由格式）
 *
 * 借鉴: DeepSeek-Reasonix src/repair/scavenge.ts
 */

import type { ToolCall, ScavengeOptions, ScavengeResult } from './types';

import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
const logger = new Logger({
  module: 'tools:repair:scavenge',
  level: LogLevel.INFO,
});

/** 限制 scavenge 输入大小 — 正则匹配在对抗性输入上可能产生 O(n²) */
const MAX_SCAVENGE_INPUT = 100 * 1024;

/**
 * 从 reasoning_content 中回收工具调用
 */
export function scavengeToolCalls(
  reasoningContent: string | null | undefined,
  opts: ScavengeOptions
): ScavengeResult {
  if (!reasoningContent) return { calls: [], notes: [] };
  if (reasoningContent.length > MAX_SCAVENGE_INPUT) {
    return {
      calls: [],
      notes: [
        `scavenge skipped: reasoning_content too large (${reasoningContent.length} chars)`,
      ],
    };
  }
  const max = opts.maxCalls ?? 4;
  const notes: string[] = [];
  const out: ToolCall[] = [];

  // Pattern A: DSML invoke 块
  for (const invoke of iterateDsmlInvokes(reasoningContent)) {
    if (out.length >= max) break;
    if (!opts.allowedNames.has(invoke.name)) continue;
    out.push({
      function: {
        name: invoke.name,
        arguments: JSON.stringify(invoke.args),
      },
    });
    notes.push(`scavenged DSML call: ${invoke.name}`);
  }

  // Pattern B: 原始 JSON 对象
  const nonDsml = stripDsmlBlocks(reasoningContent);
  for (const candidate of iterateJsonObjects(nonDsml)) {
    if (out.length >= max) break;
    const call = coerceToToolCall(candidate, opts.allowedNames);
    if (call) {
      out.push(call);
      notes.push(`scavenged call: ${call.function!.name}`);
    }
  }
  return { calls: out, notes };
}

// ─── DSML 处理 ──────────────────────────────────────────────────────────────

interface DsmlInvoke {
  name: string;
  args: Record<string, unknown>;
}

/** 移除 DSML invoke 块，防止参数 JSON 被重复回收 */
function stripDsmlBlocks(text: string): string {
  let out = text;
  out = out.replace(
    /<[｜|]DSML[｜|]function_calls>[\s\S]*?<\/?[｜|]DSML[｜|]function_calls>/g,
    ''
  );
  out = out.replace(
    /<[｜|]DSML[｜|]invoke\s+[^>]*>[\s\S]*?<\/[｜|]DSML[｜|]invoke>/g,
    ''
  );
  return out;
}

function* iterateDsmlInvokes(text: string): Generator<DsmlInvoke> {
  const INVOKE_RE =
    /<[｜|]DSML[｜|]invoke\s+name="([^"]+)">([\s\S]*?)<\/[｜|]DSML[｜|]invoke>/g;
  for (const match of text.matchAll(INVOKE_RE)) {
    const name = match[1];
    const body = match[2];
    if (!name || body === undefined) continue;
    yield { name, args: parseDsmlParameters(body) };
  }
}

/** 解析 DSML parameter 元素。当 string="false" JSON 解析失败时回退为字面量文本 */
function parseDsmlParameters(body: string): Record<string, unknown> {
  const PARAM_RE =
    /<[｜|]DSML[｜|]parameter\s+name="([^"]+)"(?:\s+string="(true|false)")?\s*>([\s\S]*?)<\/[｜|]DSML[｜|]parameter>/g;
  const args: Record<string, unknown> = {};
  for (const m of body.matchAll(PARAM_RE)) {
    const key = m[1];
    const stringFlag = m[2];
    const raw = (m[3] ?? '').trim();
    if (!key) continue;
    if (stringFlag === 'false') {
      try {
        args[key] = JSON.parse(raw);
        continue;
      } catch (err) {
        handleError(err, {
          module: 'tools:repair',
          action: 'scavengeParseJson',
        });
      }
    }
    args[key] = raw;
  }
  return args;
}

// ─── JSON 对象遍历 ──────────────────────────────────────────────────────────

/** 遍历文本中所有顶层 JSON 对象子串 */
function* iterateJsonObjects(text: string): Generator<string> {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < text.length; j++) {
      const c = text[j]!;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (inString) {
        if (c === '\\') {
          escaped = true;
          continue;
        }
        if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          yield text.slice(i, j + 1);
          i = j;
          break;
        }
      }
    }
  }
}

// ─── 工具调用推断 ───────────────────────────────────────────────────────────

function coerceToToolCall(
  candidateJson: string,
  allowedNames: ReadonlySet<string>
): ToolCall | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(candidateJson);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  // Pattern 1: { name, arguments }
  if (typeof parsed.name === 'string' && allowedNames.has(parsed.name)) {
    const args = parsed.arguments;
    return {
      function: {
        name: parsed.name,
        arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
      },
    };
  }

  // Pattern 2: OpenAI 风格 { type: "function", function: { name, arguments } }
  if (
    parsed.type === 'function' &&
    parsed.function &&
    typeof parsed.function === 'object' &&
    typeof (parsed.function as Record<string, unknown>).name === 'string' &&
    allowedNames.has(
      (parsed.function as Record<string, unknown>).name as string
    )
  ) {
    const fn = parsed.function as Record<string, unknown>;
    const args = fn.arguments;
    return {
      type: 'function',
      function: {
        name: fn.name as string,
        arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
      },
    };
  }

  // Pattern 3: R1 自由格式 { tool_name, tool_args }
  if (
    typeof parsed.tool_name === 'string' &&
    allowedNames.has(parsed.tool_name)
  ) {
    return {
      function: {
        name: parsed.tool_name,
        arguments: JSON.stringify(parsed.tool_args ?? {}),
      },
    };
  }

  return null;
}
