// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * F1（债二-预算挂起续跑 §Task 1）— 从 `ChatMessage[]` 尾部重建「未完成工具」（纯函数）
 *
 * 供 `TAORLoop.saveCheckpoint` 在落盘检查点时填充 `pendingToolCalls`；
 * 此前该字段恒为 `undefined`，导致恢复侧 `reExecuteTools` 永远为 false（永不重跑未完成工具）。
 *
 * 判据对齐事件版 `chat/utils/pendingToolCalls.ts`（`extractPendingToolCallsFromEvents`）：
 *   - answered：已有 `role === 'tool'` 消息（带 `tool_call_id`）应答的工具（已答项不重复执行）
 *   - 从消息尾部向前扫 assistant 的 `tool_calls`，遇 `role === 'user'` 停止（新对话边界）
 *   - 返回未答工具列表（`arguments` 为 JSON 字符串，解析失败则保留原串）
 */

import type { ChatMessage } from '@modules/ai/models/types.js';

export interface PendingToolCallRef {
  toolCallId: string;
  toolName: string;
  args?: unknown;
}

function parseToolArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function extractPendingToolCallsFromMessages(
  messages: readonly ChatMessage[]
): PendingToolCallRef[] {
  const answered = new Set<string>();
  for (const m of messages) {
    if (m.role === 'tool' && m.tool_call_id) {
      answered.add(m.tool_call_id);
    }
  }

  const pending: PendingToolCallRef[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user') break;
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) {
        if (!answered.has(tc.id)) {
          pending.push({
            toolCallId: tc.id,
            toolName: tc.function.name,
            args: parseToolArgs(tc.function.arguments),
          });
        }
      }
    }
  }
  return pending;
}

/** 续跑提示中单个工具调用的参数摘要长度上限（防把超长 JSON 塞进 steering） */
const ARGS_SUMMARY_MAX = 120;

function summarizeArgs(args: unknown): string {
  if (args === undefined) return '';
  let text: string;
  try {
    text = typeof args === 'string' ? args : JSON.stringify(args);
  } catch {
    text = String(args);
  }
  return text.length > ARGS_SUMMARY_MAX
    ? `${text.slice(0, ARGS_SUMMARY_MAX)}…`
    : text;
}

/**
 * I4（最终整支评审）：由「未完成工具」清单生成**续跑提示**（纯函数）。
 *
 * 为什么需要：F1 修好落盘后 `pendingToolCalls` 一度**无运行时消费者**（`resumeFromCheckpoint`
 * 不读、`bootstrap` 只把 `strategy.reason` 打日志）⇒ 执行层实际靠"新 LLM 轮重发"，未完成工具
 * 清单形同虚设。本函数把清单**消费**进续跑提示：两条链（流式重发 / batch `injectSteering`）
 * 共用同一文案口径（CS01 归一化）。
 *
 * 空/未提供清单 ⇒ 退化为通用续跑提示（不报错、不臆造工具）。
 */
export function buildBudgetResumePrompt(
  pending: readonly PendingToolCallRef[] | null | undefined
): string {
  const base =
    '[系统] 会话已从预算挂起点恢复，请从中断处继续完成未完成的任务。';
  const list = pending ?? [];
  if (list.length === 0) return base;
  const items = list.map((p) => {
    const args = summarizeArgs(p.args);
    return args ? `${p.toolName}(${args})` : `${p.toolName}()`;
  });
  return `${base}以下工具调用尚未完成，请继续：${items.join('；')}`;
}
