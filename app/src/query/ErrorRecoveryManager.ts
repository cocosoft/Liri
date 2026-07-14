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
 * ErrorRecoveryManager — Agent 循环错误恢复管理器
 *
 * Phase 1 新增。对标 cc_code 的 6 种恢复过渡和 openclaw 的多维度重试。
 * 在 LLM API 调用失败时判断恢复策略：retry / abort / compact_and_retry。
 */

/** 恢复类型 */
type RecoveryType =
  | 'empty_response'
  | 'context_overflow'
  | 'timeout'
  | 'max_output';

/** 恢复尝试记录 */
interface RecoveryAttempt {
  type: RecoveryType;
  maxRetries: number;
  retryCount: number;
  lastError?: Error;
}

/** 恢复结果 */
interface RecoveryResult {
  recovered: boolean;
  action: 'retry' | 'abort' | 'compact_and_retry';
  message?: string;
}

/** 恢复上下文 */
interface RecoveryContext {
  turnCount: number;
  tokenUsage: number;
}

/** 可序列化的恢复状态（用于 Checkpoint 持久化） */
interface RecoveryState {
  attempts: Array<[string, { type: RecoveryType; retryCount: number }]>;
}

/** 默认最大重试次数 */
const DEFAULT_MAX_RETRIES: Record<RecoveryType, number> = {
  empty_response: 3,
  context_overflow: 3,
  timeout: 2,
  max_output: 3,
};

/** 错误分类规则 */
function classifyError(error: Error): RecoveryType | null {
  const msg = error.message + ((error as any).code ?? '');

  if (/empty.?response|no.?content/i.test(msg)) return 'empty_response';
  if (/context.?length|400|413|too.?large/i.test(msg))
    return 'context_overflow';
  if (/timeout|timed.?out|ETIMEDOUT/i.test(msg)) return 'timeout';
  if (/max.?output|token.?limit|finish_reason.*length/i.test(msg))
    return 'max_output';

  return null; // 无法分类的错误不进行恢复
}

/** 各恢复类型的注入消息 */
function getRecoveryMessage(type: RecoveryType): string {
  switch (type) {
    case 'empty_response':
      return '[SYSTEM] 模型返回了空响应。请继续回答。';
    case 'max_output':
      return '[SYSTEM] 模型输出达到上限。请继续未完成的回答。';
    default:
      return '[SYSTEM] 请继续。';
  }
}

export class ErrorRecoveryManager {
  private attempts: Map<RecoveryType, RecoveryAttempt> = new Map();

  constructor() {
    // 初始化各类型的最大重试次数
    for (const type of Object.keys(DEFAULT_MAX_RETRIES) as RecoveryType[]) {
      this.attempts.set(type, {
        type,
        maxRetries: DEFAULT_MAX_RETRIES[type],
        retryCount: 0,
      });
    }
  }

  /**
   * 评估错误并返回恢复策略
   */
  assess(error: Error, context: RecoveryContext): RecoveryResult {
    const type = classifyError(error);

    if (!type) {
      // 无法分类的错误 → 不恢复，直接中止
      return { recovered: false, action: 'abort' };
    }

    const attempt = this.attempts.get(type);
    if (!attempt) {
      return { recovered: false, action: 'abort' };
    }

    attempt.lastError = error;
    attempt.retryCount++;

    if (attempt.retryCount > attempt.maxRetries) {
      return {
        recovered: false,
        action: 'abort',
        message: `恢复尝试已超过最大次数 (${attempt.maxRetries})`,
      };
    }

    switch (type) {
      case 'context_overflow':
        return {
          recovered: true,
          action: 'compact_and_retry',
          message: '上下文溢出，压缩后重试',
        };

      case 'empty_response':
      case 'max_output':
        return {
          recovered: true,
          action: 'retry',
          message: getRecoveryMessage(type),
        };

      case 'timeout':
        return {
          recovered: true,
          action: 'retry',
          message: '请求超时，请重试',
        };

      default:
        return { recovered: false, action: 'abort' };
    }
  }

  /**
   * 检查是否还可以重试
   */
  canRetry(type: RecoveryType): boolean {
    const attempt = this.attempts.get(type);
    return attempt !== undefined && attempt.retryCount < attempt.maxRetries;
  }

  /**
   * 获取指定类型的恢复消息
   */
  getRecoveryMessage(type: RecoveryType): string {
    return getRecoveryMessage(type);
  }

  /**
   * 重置某类型的重试计数
   */
  reset(type: RecoveryType): void {
    const attempt = this.attempts.get(type);
    if (attempt) {
      attempt.retryCount = 0;
      attempt.lastError = undefined;
    }
  }

  /**
   * 重置所有重试计数（新一轮对话开始时调用）
   */
  resetAll(): void {
    for (const attempt of this.attempts.values()) {
      attempt.retryCount = 0;
      attempt.lastError = undefined;
    }
  }

  /**
   * 序列化恢复状态（用于 Checkpoint 持久化）
   */
  serialize(): RecoveryState {
    const entries: Array<[string, { type: RecoveryType; retryCount: number }]> =
      [];
    for (const [key, attempt] of this.attempts) {
      entries.push([
        key,
        { type: attempt.type, retryCount: attempt.retryCount },
      ]);
    }
    return { attempts: entries };
  }

  /**
   * 从序列化状态恢复（从 Checkpoint 恢复时调用）
   */
  restore(state: RecoveryState): void {
    this.attempts = new Map();
    for (const [key, data] of state.attempts) {
      this.attempts.set(key as RecoveryType, {
        type: data.type,
        maxRetries: DEFAULT_MAX_RETRIES[data.type] ?? 3,
        retryCount: data.retryCount,
      });
    }
  }
}

/** 工厂函数 */
export function createErrorRecoveryManager(): ErrorRecoveryManager {
  return new ErrorRecoveryManager();
}
