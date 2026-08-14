/**
 * reactEventsToChunks — ReActEvent → ChatStreamChunk 事件转换层（M1a）
 *
 * 骨架 run() 产出抽象的 ReActEvent，生产调用点（streamMessageFlow）需要
 * ChatStreamChunk。本函数把 ReActEvent 映射为 0..N 个 ChatStreamChunk，
 * 迁移期间作为新旧循环的薄适配层（M2 双跑对比的转换基准）。
 */

import type { ChatStreamChunk } from '@modules/runtime/api/CoreAPI.js';
import type { ReActEvent } from '../query/ReActLoop.js';

export function reactEventsToChunks(
  event: ReActEvent,
  sessionId: string
): ChatStreamChunk[] {
  switch (event.type) {
    case 'reasoning_start':
      return [
        {
          type: 'status',
          content: '思考中',
          sessionId,
          statusType: 'ai_thinking',
        },
      ];

    case 'reasoning_delta':
      return event.text
        ? [{ type: 'text', content: event.text, sessionId }]
        : [];

    case 'thinking_delta':
      return event.content
        ? [{ type: 'thinking', content: event.content, sessionId }]
        : [];

    case 'phase':
      // TAORLoop 阶段事件：内部语义（runLogger/checkpoint），无前端 chunk 映射
      return [];

    case 'reasoning_end':
      // M4（方案 A）：文本已由 reasoning_delta 逐 chunk 增量输出，此处不再重复输出
      // （A-path 首轮 text 为空也无输出）；result 仅用于内部（工具调用/终止原因）
      return [];

    case 'acting_start':
      return [
        {
          type: 'status',
          content: `执行 ${event.toolCount} 个工具调用`,
          sessionId,
        },
      ];

    case 'tool_start':
      // P0-1（2026-08-14）：携带工具参数（event.input），前端 ToolCallGroup 展示"人话"摘要。
      // 修复 M1 迁移后 arguments 恒为空 → 用户看不到工具执行了什么。
      return [
        {
          type: 'tool_call',
          content: '',
          sessionId,
          toolCall: {
            id: event.callId,
            name: event.name,
            arguments: event.input ?? {},
            status: 'running',
          },
        },
      ];

    case 'tool_end':
      // 更新 tool_start 建卡的状态：completed / failed（对齐旧类 tool_call 完成 chunk）；
      // P0-2（2026-08-14）：补 result（ToolResultEntry.output），前端渲染普通工具执行结果。
      // 失败时另补一条状态提示
      return [
        {
          type: 'tool_call',
          content: '',
          sessionId,
          toolCall: {
            id: event.callId,
            name: event.result.name,
            arguments: {},
            status: event.result.status === 'error' ? 'failed' : 'completed',
            result:
              event.result.output !== undefined
                ? { success: true, data: event.result.output }
                : undefined,
          },
        },
        ...(event.result.status === 'error'
          ? [
              {
                type: 'status',
                content: event.result.error ?? '工具执行失败',
                sessionId,
                statusType: 'tool_retry',
              } as ChatStreamChunk,
            ]
          : []),
      ];

    case 'acting_end':
      return [];

    case 'iteration_end':
      return [];

    case 'error':
      return [
        {
          type: 'error',
          content: event.message,
          sessionId,
          errorCode: 'UNKNOWN',
        },
      ];

    case 'aborted':
      return [
        {
          type: 'error',
          content: '已中止',
          sessionId,
          errorCode: 'UNKNOWN',
        },
      ];

    default:
      return [];
  }
}
