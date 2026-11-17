// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 本地查询工具的短路实现（2026-11-17，T3 复杂度清理）。
 *
 * 从 `ToolExecutionService._executeInternal` **原样搬出**：`get_tool_result` /
 * `session_lookup` / `list_tool_calls` 三个工具不经工具注册表与权限链，在执行入口最前面
 * 就地返回。搬出后以 `null` 表示"不是这三类工具"，调用方继续走常规执行路径。
 *
 * 为什么独立成模块：`_executeInternal` 圈复杂度 149，且这三段只依赖
 * `toolResultRegistry` 与注入的 `sessionLookup`（无 `this` 状态）⇒ 抽成纯函数即可直接单测
 * （见 `app/tests/chat/localQueryTools.test.ts`）。
 */
import { getLogger } from '@openliri/infra/monitoring';
import { toolResultRegistry } from '@modules/tool/ToolResultRegistry.js';
import type { ToolResult } from '@modules/session/types/tool.js';

const logger = getLogger('chat:toolExecution');

/** 与 `ToolExecutionDeps` 对应字段同口径（避免 chat → service 反向依赖） */
export interface LocalQueryToolDeps {
  sessionLookup?: (args: {
    sessionId: string;
    fromSeq?: number;
    toSeq?: number;
    offset?: number;
    limit?: number;
  }) => Promise<{
    ok: boolean;
    content?: string;
    nextFromSeq?: number;
    reason?: string;
  }>;
  currentSessionId?: string;
}

export interface LocalQueryToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * 命中三类本地查询工具 ⇒ 返回其结果；否则返回 `null`。
 */
export async function tryHandleLocalQueryTool(
  toolCall: LocalQueryToolCall,
  deps: LocalQueryToolDeps
): Promise<ToolResult | null> {
  // ── 本地查询工具 ──
  if (toolCall.name === 'get_tool_result') {
    const targetId = toolCall.arguments.tool_call_id as string;
    const stored = toolResultRegistry.findByCallId(targetId);
    logger.info('LLM 查询工具结果', {
      toolCallId: toolCall.id,
      targetId,
      found: !!stored,
    });
    if (!stored) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: { found: false, toolCallId: targetId },
        error: undefined,
      };
    }
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: { found: true, toolCall: stored },
      error: undefined,
    };
  }

  // ── C 阶段（2026-09-02，P1）：session_lookup — 按事件区间取回被切早期原文 ──
  if (toolCall.name === 'session_lookup') {
    const args = toolCall.arguments as {
      sessionId?: string;
      fromSeq?: number;
      toSeq?: number;
      offset?: number;
      limit?: number;
    };
    if (!deps.sessionLookup) {
      return {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        result: {
          ok: false,
          error:
            'session_lookup 未在当前运行环境注册（分层关闭或非会话上下文）',
        },
        error: undefined,
      };
    }
    const sessionId = args.sessionId || deps.currentSessionId || '';
    const lookup = await deps.sessionLookup({
      sessionId,
      fromSeq: args.fromSeq,
      toSeq: args.toSeq,
      offset: args.offset,
      limit: args.limit,
    });
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: {
        ok: lookup.ok,
        ...(lookup.ok
          ? { content: lookup.content ?? '', nextFromSeq: lookup.nextFromSeq }
          : { error: lookup.reason ?? '取回失败' }),
      },
      error: undefined,
    };
  }

  if (toolCall.name === 'list_tool_calls') {
    const targetRound = toolCall.arguments.round as number | undefined;
    const sessionId =
      (toolCall.arguments.sessionId as string) || deps.currentSessionId || '';
    let calls: Array<{
      toolCallId: string;
      toolName: string;
      round: number;
      hasError: boolean;
      timestamp: number;
    }>;
    if (targetRound && sessionId) {
      calls = toolResultRegistry
        .listByRound(sessionId, targetRound)
        .map((c) => ({
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          round: c.round,
          hasError: !!c.result.error,
          timestamp: c.timestamp,
        }));
    } else if (sessionId) {
      calls = toolResultRegistry.listBySession(sessionId).map((c) => ({
        toolCallId: c.toolCallId,
        toolName: c.toolName,
        round: c.round,
        hasError: !!c.result.error,
        timestamp: c.timestamp,
      }));
    } else {
      calls = toolResultRegistry
        .listAll()
        .map((c) => ({
          toolCallId: c.toolCallId,
          toolName: c.toolName,
          round: c.round,
          hasError: !!c.result.error,
          timestamp: c.timestamp,
        }))
        .slice(0, 50);
    }
    return {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      result: {
        toolCalls: calls,
        total: calls.length,
        sessionId: sessionId || undefined,
      },
      error: undefined,
    };
  }

  return null;
}
