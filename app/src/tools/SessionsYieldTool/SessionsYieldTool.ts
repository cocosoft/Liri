/**
 * SessionsYieldTool
 *
 * 会话控制权交还工具（阶段 A：真实实现，取代原"成功但无副作用"的桩）。
 *
 * 语义（见 `.trae/documents/阶段A-yield真实实现Spec.md`）：
 * 模型在等待子代理结算时调用本工具让出本轮 turn；**本轮是否真的以 yield 收尾**，
 * 由收尾点（`ChatManager._finalizeStreamMessage`）依据本工具的结果 + 消息序列判定并登记等待
 * （turn 编号只有收尾点可知，故此处只做校验与契约化返回，不登记）。
 */

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import { YIELD_RESULT_STATUS, YIELD_TOOL_NAME } from '../../session/yield';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:SessionsYieldTool:SessionsYieldTool');

export interface YieldConfig {
  reason?: string;
  message?: string;
}

export interface YieldResult {
  /** 契约状态：成功 yield 的唯一标识值（判定函数 isSuccessfulYieldResult 依此匹配） */
  status: typeof YIELD_RESULT_STATUS;
  /** 发起 yield 的会话（取自工具上下文，不再硬编码 'current'） */
  sessionId: string;
  reason: string;
  message?: string;
  timestamp: number;
}

/**
 * 构造 yield 契约结果（**唯一构造点**）。纯函数、无副作用。
 *
 * 2026-09-20（N-36 双轨收敛）：原与 `SessionsTool.handleYield` 共用本构造点；但 yield 管线
 * （`yieldDetection` 判定 + `yieldTurnRegistration` 登记）**只认工具名 `sessions_yield`**，
 * 故 `sessions` 的 yield 动作已移除，本构造点现由本工具单独使用。
 */
export function buildYieldResult(params: {
  sessionId: string;
  reason?: string;
  message?: string;
  timestamp?: number;
}): YieldResult {
  return {
    status: YIELD_RESULT_STATUS,
    sessionId: params.sessionId,
    reason: params.reason ?? 'yielding control to sub-agent results',
    message: params.message,
    timestamp: params.timestamp ?? Date.now(),
  };
}

export class SessionsYieldTool extends BaseTool {
  name = YIELD_TOOL_NAME;

  description =
    'Yield the current turn back to the session while delegated sub-agents finish, so their results can be awaited; the turn resumes with those results. This is the ONLY tool that yields a turn — the `sessions` tool manages sessions and cannot yield.';

  params: ToolParam[] = [
    {
      name: 'reason',
      type: 'string',
      description: 'Reason for yielding control',
      required: false,
    },
    {
      name: 'message',
      type: 'string',
      description: 'Optional message passed to the receiving session',
      required: false,
    },
  ];

  async execute(input: unknown, context?: ToolUseContext): Promise<ToolResult> {
    const config = (input ?? {}) as YieldConfig;
    const sessionId = context?.sessionId;

    if (!sessionId) {
      // 无会话上下文即无法建立等待登记：显式失败，不再返回"成功但无副作用"
      return {
        success: false,
        error:
          'sessions_yield requires a session context (context.sessionId is missing)',
      };
    }

    const result = buildYieldResult({
      sessionId,
      reason: config.reason,
      message: config.message,
    });

    logger.info('sessions_yield: yield intent accepted', {
      sessionId,
      reason: result.reason,
      hasMessage:
        typeof result.message === 'string' && result.message.length > 0,
    });

    return {
      success: true,
      data: result,
      output: JSON.stringify(result),
    };
  }
}
