// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * yield 判定（阶段 A / A1-a，纯函数、无 IO、无副作用）
 *
 * 口径：`.trae/documents/阶段A-yield真实实现Spec.md` §3-D1 ——
 * 输入为 Liri 真实载体（`turn/end` 事件 data / 工具结果 / 消息序列），
 * 而非对标实现的 run 生命周期对象。
 */

import {
  YIELD_TOOL_NAME,
  YIELD_RESULT_STATUS,
  YIELD_FINISH_REASON,
} from './constants';

/** 对象守卫（本地实现：全仓无通用同类工具，不为此造公共抽象） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 字符串或对象 → 记录（字符串按 JSON 解析，失败返回 null，不抛错） */
function toRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 判定 `turn/end` 事件的 data 是否为 yield 收尾。
 *
 * 判定项（映射自对标契约，见 Spec §3-D1 映射表）：
 * `yielded === true` + `finishReason === 'yielded'` + 无 error。
 */
export function isYieldedTurnEnd(data: unknown): boolean {
  if (!isRecord(data)) return false;
  if (data['yielded'] !== true) return false;
  if (data['finishReason'] !== YIELD_FINISH_REASON) return false;
  return data['error'] === undefined || data['error'] === null;
}

/**
 * 判定工具结果是否为**成功的 yield**。
 *
 * 兼容两种载体：
 * - `ToolResult` 对象：`{ success?, data?, output?, error? }`
 * - `tool/result` 事件的 result 字段（字符串形态，按 JSON 解析）
 *
 * 判定：无 error + 非 `success:false` + yield 状态为 `'yielded'`
 * （状态取自 `data.status`，回退 `output` 的 JSON `status`）。
 * 解析失败一律返回 `false`，**不抛错**。
 */
export function isSuccessfulYieldResult(result: unknown): boolean {
  const record = toRecord(result);
  if (!record) return false;
  if (record['error'] !== undefined && record['error'] !== null) return false;
  if (record['success'] === false) return false;
  return extractYieldStatus(record) === YIELD_RESULT_STATUS;
}

/** 从结果体提取 yield 状态：优先顶层 `status`，其次 `data.status`，再回退 `output`(JSON).status */
function extractYieldStatus(record: Record<string, unknown>): string | null {
  // 1) 顶层 status —— 工具直接返回契约对象（如 buildYieldResult 的输出）
  if (typeof record['status'] === 'string') {
    return record['status'];
  }
  // 2) data.status —— BaseTool 形态的 ToolResult
  const data = record['data'];
  if (isRecord(data) && typeof data['status'] === 'string') {
    return data['status'];
  }
  // 3) output 为 JSON 字符串
  const output = record['output'];
  if (typeof output === 'string') {
    const parsed = toRecord(output);
    if (parsed && typeof parsed['status'] === 'string') {
      return parsed['status'];
    }
  }
  return null;
}

/** 读取 tool_call 的工具名（兼容 `{ name }` 与 OpenAI 形态 `{ function: { name } }`） */
function readToolCallName(call: Record<string, unknown>): string | null {
  const direct = call['name'];
  if (typeof direct === 'string') return direct.trim();
  const fn = call['function'];
  if (isRecord(fn) && typeof fn['name'] === 'string') return fn['name'].trim();
  return null;
}

/**
 * 从消息序列中提取**本轮最后一次** `sessions_yield` 的 toolCallId。
 *
 * 从末尾向前扫描：遇 `role === 'user'` 即止（本轮边界）；
 * 命中的 assistant 消息内若含多个 yield tool_call，也**从后往前**取最后一个。
 * 未命中返回 `null`（调用方据此判定"本轮没有 yield"）。
 */
export function getYieldToolCallId(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!isRecord(message)) continue;
    const role = message['role'];
    if (role === 'user') return null;
    if (role !== 'assistant') continue;
    const calls = message['tool_calls'];
    if (!Array.isArray(calls)) continue;
    // 同一消息内的多个 yield 调用：取最后一个（本轮最后一次调用）
    for (let j = calls.length - 1; j >= 0; j--) {
      const call = calls[j];
      if (!isRecord(call)) continue;
      const id = call['id'];
      if (
        readToolCallName(call) === YIELD_TOOL_NAME &&
        typeof id === 'string' &&
        id.length > 0
      ) {
        return id;
      }
    }
  }
  return null;
}
