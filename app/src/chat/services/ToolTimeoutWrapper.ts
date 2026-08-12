// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * ToolTimeoutWrapper — 工具执行超时包装器
 *
 * P3（08-09）：从 ChatManager._withToolTimeout 提取为独立函数，
 * 降低 ChatManager 上帝类复杂度。
 */

import crypto from 'crypto';
import { configManager } from '@modules/config';
import { getLogger } from '@modules/monitoring';
import { getOTelTracing } from '@modules/monitoring/otel';
import {
  AppError,
  ErrorCategory,
  ErrorSeverity,
  handleError,
} from '@modules/error';
import type { ToolCall, ToolResult } from '../types/tool.js';

const logger = getLogger('chat:toolTimeout');

/**
 * 带超时保护的工具执行包装器。
 *
 * @param executor - 工具执行函数
 * @param toolCall - 工具调用信息
 * @param timeoutMs - 超时毫秒数（默认 300_000 = 5 分钟）
 */
export async function withToolTimeout(
  executor: () => Promise<ToolResult>,
  toolCall: ToolCall,
  timeoutMs?: number
): Promise<ToolResult> {
  const otel = getOTelTracing();
  const span = otel.startSpan('chat:toolTimeout', {
    'tool.name': toolCall.name,
    'tool.timeoutMs':
      timeoutMs ??
      (parseInt(configManager.env('TOOL_EXEC_TIMEOUT_MS') || '', 10) ||
        300_000),
  });
  const effectiveTimeout =
    timeoutMs ??
    (parseInt(configManager.env('TOOL_EXEC_TIMEOUT_MS') || '', 10) || 300_000);
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    executor(),
    new Promise<ToolResult>((resolve) => {
      timer = setTimeout(() => {
        const argHash = crypto
          .createHash('sha256')
          .update(JSON.stringify(toolCall.arguments || {}))
          .digest('hex')
          .slice(0, 16);
        logger.warn('工具执行超时，返回超时结果（底层工具无法强制取消）', {
          toolName: toolCall.name,
          timeoutMs: effectiveTimeout,
          argHash,
        });
        // 风险 1：追踪幽灵工具执行（超时后底层工具仍在后台运行）
        handleError(
          new AppError(
            `工具执行超时 — 幽灵执行风险：${toolCall.name}（argHash=${argHash}）`,
            ErrorCategory.EXECUTION,
            ErrorSeverity.MEDIUM,
            'TOOL_EXEC_TIMEOUT_GHOST'
          ),
          {
            module: 'chat:toolTimeout',
            action: 'toolTimeout',
            context: {
              toolName: toolCall.name,
              argHash,
              timeoutMs: effectiveTimeout,
            },
          }
        );
        // 风险 2：超时结果标记 retryable: false，防止 LLM 重试导致副作用翻倍
        resolve({
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          result: null,
          error: `工具执行超时（${effectiveTimeout}ms）`,
          metadata: { retryable: false, argHash },
        });
      }, effectiveTimeout);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
    try {
      otel.endSpan(span);
    } catch {
      /* span 可能已结束 */
    }
  });
}
