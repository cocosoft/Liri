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

    case 'reasoning_end':
      // 骨架 reason() 为 async 方法无法逐 chunk 增量 yield，整段文本在此一次性输出
      // （旧类 P0-C 为增量输出，观察期记录该体验差异；A-path 首轮 text 为空自动跳过）
      return event.result.text
        ? [{ type: 'text', content: event.result.text, sessionId }]
        : [];

    case 'acting_start':
      return [
        {
          type: 'status',
          content: `执行 ${event.toolCount} 个工具调用`,
          sessionId,
        },
      ];

    case 'tool_start':
      return [
        {
          type: 'tool_call',
          content: '',
          sessionId,
          toolCall: {
            id: event.callId,
            name: event.name,
            arguments: {},
            status: 'running',
          },
        },
      ];

    case 'tool_end':
      // 更新 tool_start 建卡的状态：completed / failed（对齐旧类 tool_call 完成 chunk）；
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
