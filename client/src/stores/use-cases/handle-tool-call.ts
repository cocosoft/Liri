/**
 * handleToolCall use-case — 工具调用分发编排
 *
 * 跨 Slice 编排：chatStore tool_call → toolResultRegistry → 前端渲染。
 *
 * 当前架构中，工具调用的执行和结果记录由后端 ToolManager + toolResultRegistry
 * 通过流式管道处理。此 use-case 为未来前端侧工具编排预留接口。
 */

import { createLogger } from "@/utils/logger";

const logger = createLogger("usecase:handleToolCall");

/** 工具调用结果 */
export interface ToolCallResult {
  toolCallId: string;
  toolName: string;
  success: boolean;
  result: Record<string, unknown>;
}

/**
 * 分发工具调用
 *
 * @deprecated 当前为骨架实现（始终返回 success: false）。
 * 工具调用由后端 ToolManager + toolResultRegistry 通过流式管道处理。
 * 此 use-case 为未来前端侧工具编排预留接口（Phase 3）。
 * 当前调用方不应依赖此函数的返回值做业务决策。
 */
export function handleToolCall(
  toolCallId: string,
  toolName: string,
  params: Record<string, unknown>,
): ToolCallResult {
  logger.debug("工具调用分发", { toolCallId, toolName, params });

  // Phase 3: 委托给 toolResultRegistry 执行并记录结果
  return {
    toolCallId,
    toolName,
    success: false,
    result: { _placeholder: "Phase 3 — 待对接 toolResultRegistry" },
  };
}
