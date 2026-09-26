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
 * 评测轨迹抽取（D2 第 3 批，2026-09-12）—— L2 工具调用序列断言的基础设施
 *
 * 数据来源：`GET /v1/sessions/:id/messages` 的**持久化消息**，而不是解析 SSE 增量。
 * 依据 project_rules §1.6（Write-Ahead Persistence）：助手消息（含工具调用）在流结束前
 * 已落盘，因此从盘读取得到的是**最终序列**（含重试与全部轮次），比增量解析更可靠。
 *
 * 纯函数实现（不依赖沙箱/网络），以便被"判分器自身回归"用例直接覆盖。
 */

import type { ToolCallDetail, ToolCallRecord } from './types.js';

/** 解析工具参数：既接受对象，也接受 JSON 字符串（OpenAI 风格 function.arguments） */
function parseArgs(raw: unknown): Record<string, unknown> | undefined {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    // 参数被截断或非 JSON：不影响"调用了哪个工具"的判定，仅丢失参数级断言能力
    return undefined;
  }
}

/** 抽取单条消息里的工具调用（兼容三种持久化形态） */
function callsFromMessage(msg: Record<string, unknown>): ToolCallRecord[] {
  const out: ToolCallRecord[] = [];

  // 形态 1：助手消息的 tool_calls[]（OpenAI 风格：{id, type, function:{name, arguments}}）
  if (Array.isArray(msg.tool_calls)) {
    for (const raw of msg.tool_calls as Array<Record<string, unknown>>) {
      const fn = raw.function as
        | { name?: unknown; arguments?: unknown }
        | undefined;
      const name = String(fn?.name ?? raw.name ?? '').trim();
      if (!name) continue;
      out.push({
        name,
        id: typeof raw.id === 'string' ? raw.id : undefined,
        args: parseArgs(fn?.arguments ?? raw.arguments),
      });
    }
  }

  // 形态 2/3：content[] 与 blocks[] 中的 tool_call 块（ContentBlock.toolName/toolArgs）
  for (const key of ['content', 'blocks'] as const) {
    const list = msg[key];
    if (!Array.isArray(list)) continue;
    for (const raw of list as Array<Record<string, unknown>>) {
      const kind = String(raw.type ?? raw.blockType ?? '');
      if (kind !== 'tool_call') continue;
      const name = String(raw.toolName ?? raw.name ?? '').trim();
      if (!name) continue;
      out.push({
        name,
        id: typeof raw.toolCallId === 'string' ? raw.toolCallId : undefined,
        args: parseArgs(raw.toolArgs ?? raw.args),
      });
    }
  }

  return out;
}

/**
 * 从 `GET /v1/sessions/:id/messages` 的响应体抽取工具调用序列（顺序 = 发生顺序）。
 *
 * 响应体兼容两种形态：裸数组，或 `{ messages: [...] }`（见
 * `session-handlers.ts:254-268`）。按 `id` 去重，防御"历史双写 / SSE 重复"导致的同一次
 * 调用出现多块（后端 `dedupeMessagesToolCallBlocks` 已做一层，这里再兜一层）。
 */
export function extractToolCalls(body: unknown): ToolCallRecord[] {
  const messages: unknown[] = Array.isArray(body)
    ? body
    : ((body as { messages?: unknown[] } | null)?.messages ?? []);

  const seen = new Set<string>();
  const out: ToolCallRecord[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    for (const call of callsFromMessage(msg as Record<string, unknown>)) {
      if (call.id) {
        if (seen.has(call.id)) continue;
        seen.add(call.id);
      }
      out.push(call);
    }
  }
  return out;
}

/** 工具名序列（断言与报告常用） */
export function toolCallNames(calls: ToolCallRecord[]): string[] {
  return calls.map((c) => c.name);
}

/**
 * A1（2026-09-26）：单个参数值的截断上限（字符）。
 *
 * 500 足够看清"读了哪个文件 / 写了什么命令 / 搜了什么模式"，又能避免把整份文件内容写进报告。
 */
export const TOOL_CALL_ARG_MAX_CHARS = 500;

/**
 * 逐值截断（A1）。
 *
 * - 原语（number / boolean / null / undefined）**原样保留** —— 截断它们没有意义；
 * - 字符串超长 ⇒ 裁剪并附 `…[+N]`；
 * - 对象 / 数组 ⇒ 先 `JSON.stringify`：不超长则**保留原结构**（保证"结构稳定"），
 *   超长则降级为**字符串**（裁剪 + `…[+N]`）—— 避免报告体积与深层嵌套失控。
 */
function truncateArgValue(value: unknown, maxChars: number): unknown {
  if (value === null || value === undefined) return value;
  const kind = typeof value;
  if (kind === 'number' || kind === 'boolean') return value;
  if (kind === 'string') {
    const s = value as string;
    return s.length > maxChars
      ? `${s.slice(0, maxChars)}…[+${s.length - maxChars}]`
      : s;
  }
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    // 循环引用等不可序列化情形：保留可读标记而非抛错（报告不应因参数形状而失败）
    return '[unserializable]';
  }
  if (json === undefined) return '[unserializable]';
  return json.length > maxChars
    ? `${json.slice(0, maxChars)}…[+${json.length - maxChars}]`
    : value;
}

/**
 * 工具调用明细（A1）：`{ name, args }` 序列，参数逐值截断。
 *
 * **为什么需要**：报告此前只落 [`toolCallNames()`]（`runner.ts:274`），断言期内存里本就有完整
 * args（`runner.ts:249` 传 `ToolCallRecord[]`）却在落盘时丢掉 ⇒ 报告"不可离线重算"，
 * 也无法支撑 A2 的行为指标。本函数与 `toolCallNames()` 共用同一输入，**互不影响**。
 */
export function buildToolCallsDetail(
  calls: ToolCallRecord[]
): ToolCallDetail[] {
  return calls.map((c) => {
    const entry: ToolCallDetail = { name: c.name };
    if (!c.args) return entry;
    const args: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(c.args)) {
      args[key] = truncateArgValue(value, TOOL_CALL_ARG_MAX_CHARS);
    }
    entry.args = args;
    return entry;
  });
}
