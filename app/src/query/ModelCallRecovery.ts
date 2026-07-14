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
 * ModelCallRecovery — LLM 调用错误恢复辅助
 *
 * 从 ChatManager 提取。评估 API 调用失败的错误并决定恢复策略。
 * 需要注入 ErrorRecoveryManager 实例。
 */

import type { ErrorRecoveryManager } from './ErrorRecoveryManager.js';

interface RecoveryContext {
  turnCount: number;
  tokenUsage: number;
}

interface LoggerLike {
  warn: (msg: string, ctx?: Record<string, unknown>) => void;
}

export async function callModelWithRecovery<R>(
  recovery: ErrorRecoveryManager,
  logger: LoggerLike,
  callFn: () => Promise<R>,
  context: RecoveryContext,
  onRecoveryMessage?: (msg: string) => void
): Promise<R> {
  try {
    return await callFn();
  } catch (error) {
    const result = recovery.assess(error as Error, context);

    if (result.action === 'abort') {
      throw error;
    }

    if (result.action === 'retry' && result.message) {
      logger.warn('LLM call error, retrying', {
        error: String(error),
        message: result.message,
      });
      onRecoveryMessage?.(result.message);
      recovery.reset('empty_response');
      return callFn();
    }

    throw error;
  }
}
