// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 会话侧工具定义（E 批外移，2026-11-05）
 *
 * 从 `ChatManager` 迁出的静态 `ToolDefinition` 常量（纯数据，无宿主依赖）：
 * - `SESSION_LOOKUP_TOOL`：按事件区间取回被切早期原文（C 阶段 2026-09-02，P1，C 详设 §4）。
 *
 * 同时删除两个**零引用**的私有静态定义（`QUERY_TOOL_GET_RESULT` / `QUERY_TOOL_LIST_CALLS`，
 * 与 `orchestrator/toolErrorMessages` 同类：定义后从未注册/调用 —— CD01–CD06 核查：
 * 静态引用 0、无动态导入、注册表无同名项）。
 */

import type { ToolDefinition } from '@modules/ai';

/**
 * C 阶段（2026-09-02，P1，C 详设 §4）：session_lookup — 按事件区间取回被切早期原文。
 * 分页（每页 ≤2K tokens，nextFromSeq 续页），只读，仅限当前会话。
 */
export const SESSION_LOOKUP_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'session_lookup',
    description:
      '取回当前会话中较早的原始对话记录（当上下文压缩/分层未携带早期内容时使用）。支持按事件序号（fromSeq）或从会话开头（offset）分页取回，每页约 2000 tokens；返回的 nextFromSeq 可继续翻页直到取完。',
    parameters: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: '当前会话 id' },
        fromSeq: {
          type: 'number',
          description:
            '起始事件序号（上一页返回的 nextFromSeq）。不传则从会话开头或按 offset 定位。',
        },
        toSeq: {
          type: 'number',
          description: '可选，截止事件序号（默认取至一页容量）。',
        },
        offset: {
          type: 'number',
          description:
            '可选，从会话开头跳过的事件条数（与 fromSeq 二选一，用于从头翻页）。',
        },
        limit: {
          type: 'number',
          description: '可选，本页最大事件条数（默认按 token 预算自动折算）。',
        },
      },
      required: [],
    },
  },
};
