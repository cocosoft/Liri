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
 * ContextAutoCompressor — 上下文自动压缩辅助
 *
 * 从 ChatManager 提取。在 LLM 调用前用 TruncatorEngine 压缩消息列表。
 * 需要注入 ContextEngineRegistry、TokenBudget、ContextTracker 和 ENABLE flag。
 */

import type { ContextEngineRegistry } from './context/ContextEngineRegistry.js';
import type { TokenBudgetManager } from './TokenBudget.js';
import type { ContextTracker } from './context/ContextTracker.js';
import type { ChatMessage } from '../ai/models/types';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'query:ContextAutoCompressor',
  level: LogLevel.INFO,
});

interface CompressionDeps {
  engineRegistry: ContextEngineRegistry;
  tokenBudget: TokenBudgetManager;
  contextTracker: ContextTracker;
  estimateTokens: (messages: Record<string, unknown>[]) => number;
  turnCount: () => number;
  logger: {
    info: (msg: string, ctx?: Record<string, unknown>) => void;
    warn: (msg: string, ctx?: Record<string, unknown>) => void;
  };
}

export async function autoCompressContext(
  messages: Record<string, unknown>[],
  deps: CompressionDeps,
  enabled: boolean
): Promise<Record<string, unknown>[]> {
  if (!enabled) return messages;

  try {
    const currentTokens = deps.estimateTokens(messages);
    const maxTokens = deps.tokenBudget.getCurrentBudgetState().maxTokens;

    const engine = deps.engineRegistry.get('truncator');
    if (!engine) return messages;

    if (!engine.shouldCompress(currentTokens, maxTokens)) return messages;

    const beforeTokens = currentTokens;
    const result = await engine.compress(
      messages as unknown as ChatMessage[],
      maxTokens
    );

    const afterTokens = deps.estimateTokens(
      result.messages as unknown as Record<string, unknown>[]
    );

    deps.contextTracker.record({
      timestamp: Date.now(),
      turnCount: deps.turnCount(),
      engineName: engine.id,
      beforeTokens,
      afterTokens,
      compressionRatio: beforeTokens > 0 ? afterTokens / beforeTokens : 1,
      messageCountBefore: messages.length,
      messageCountAfter: result.messages.length,
      hasFocusTopic: false,
    });

    deps.logger.info('auto-compress completed', {
      engine: engine.id,
      beforeTokens,
      afterTokens,
      ratio: beforeTokens > 0 ? (afterTokens / beforeTokens).toFixed(2) : 'N/A',
    });

    return result.messages as unknown as Record<string, unknown>[];
  } catch (err) {
    deps.logger.warn('auto-compress failed, continuing uncompressed', {
      error: String(err),
    });
    return messages;
  }
}
