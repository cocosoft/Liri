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

import { getLogger } from '@modules/monitoring';
const logger = getLogger('query:errorRecovery');

/** 恢复类型 */
type RecoveryType =
  | 'empty_response'
  | 'context_overflow'
  | 'timeout'
  | 'max_output'
  | 'server_error'
  | 'rate_limit'
  | 'network_error'
  | 'unknown'
  // 2026-08-31 C1：对标 PilotDeck AgentLoop 精细化恢复
  | 'invalid_tool_arguments'
  | 'prompt_too_long';

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
  action:
    | 'retry'
    | 'abort'
    | 'compact_and_retry'
    // 2026-08-31 C1：精细化恢复动作
    | 'retry_with_correction'
    | 'retry_higher_output'
    | 'truncate_head_and_retry';
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
  /** 压缩是否已尝试过（防止压缩-重试死循环） */
  compactAttempted?: boolean;
  /** C1：max_output 翻倍是否已尝试 */
  maxOutputDoubled?: boolean;
}

/** 默认最大重试次数 */
const DEFAULT_MAX_RETRIES: Record<RecoveryType, number> = {
  empty_response: 3,
  context_overflow: 3,
  timeout: 2,
  max_output: 3,
  server_error: 2,
  rate_limit: 2,
  network_error: 2,
  unknown: 2,
  // C1：JSON 自纠错上限 3 次（对标 PilotDeck jsonSelfCorrect 3 次上限）
  invalid_tool_arguments: 3,
  // C1：截头为破坏性操作，单次（对标 PilotDeck truncate_head 每 turn 单次）
  prompt_too_long: 1,
};

/** 错误分类规则 */
function classifyError(error: Error): RecoveryType {
  const msg =
    error.message + ((error as unknown as Record<string, unknown>).code ?? '');

  // C1：非法工具参数 → JSON 自纠错（对标 PilotDeck invalid_tool_arguments 分支）
  if (
    /invalid.?tool|tool.?argument|failed.to.parse.*json|invalid_json|arguments.*not.*valid/i.test(
      msg
    )
  )
    return 'invalid_tool_arguments';

  // C1：prompt 超长 → 截头重试（对标 PilotDeck truncate_head_and_retry）
  if (/prompt.?is.?too.?long|prompt.?too.?long|input.?is.?too.?long/i.test(msg))
    return 'prompt_too_long';

  if (/empty.?response|no.?content/i.test(msg)) return 'empty_response';
  if (/context.?length|400|413|too.?large/i.test(msg))
    return 'context_overflow';
  if (/timeout|timed.?out|ETIMEDOUT/i.test(msg)) return 'timeout';
  if (/max.?output|token.?limit|finish_reason.*length/i.test(msg))
    return 'max_output';

  // 新增：服务端错误 → 重试
  if (
    /5\d\d|server.error|internal.server|bad.gateway|service.unavailable/i.test(
      msg
    )
  )
    return 'server_error';

  // 新增：速率限制 → 重试
  if (/429|rate.limit|too.many.requests/i.test(msg)) return 'rate_limit';

  // 新增：网络连接错误 → 重试
  if (
    /fetch.failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|network.error|socket.hang|UND_ERR/i.test(
      msg
    )
  )
    return 'network_error';

  // 兜底：未分类错误 → 走重试（有最大重试次数保护）
  return 'unknown';
}

/**
 * 本地确定性错误检测（对标 hermes TurnRetryState：本地 bug 不重试 vs API 瞬态重试）。
 *
 * 重试 API 瞬态错误（429/5xx/网络）有意义；但本地代码 bug（TypeError/ReferenceError
 * 等）重试必然再次失败——只掩盖真实缺陷并浪费 token/时间。assess() 对
 * 确定性本地错误直接 abort 不重试。
 */
function isDeterministicLocalError(error: Error): boolean {
  // 原生 JS 错误类型：本地代码缺陷（非 API/网络瞬态）
  const name = error.name;
  if (
    name === 'TypeError' ||
    name === 'ReferenceError' ||
    name === 'RangeError' ||
    name === 'SyntaxError' ||
    name === 'EvalError' ||
    name === 'URIError'
  ) {
    return true;
  }
  // 本地模式：模块加载/断言/非法访问（排除网络/API 关键词，避免误判）
  const msg = error.message;
  return (
    /Cannot (read|set) properties of/i.test(msg) ||
    /is not a function/i.test(msg) ||
    /is not defined/i.test(msg) ||
    /Cannot find module/i.test(msg) ||
    /Unexpected token/i.test(msg) ||
    /Assertion failed/i.test(msg)
  );
}

/** 各恢复类型的注入消息 */
function getRecoveryMessage(type: RecoveryType, errorMsg?: string): string {
  switch (type) {
    case 'empty_response':
      return '[SYSTEM] 模型返回了空响应。请继续回答。';
    case 'max_output':
      return '[SYSTEM] 模型输出达到上限。请继续未完成的回答。';
    case 'server_error':
      return `[SYSTEM] 服务端错误（${errorMsg?.slice(0, 100) ?? '未知'}），请重试。`;
    case 'rate_limit':
      return '[SYSTEM] 请求频率过高，请稍后重试。';
    case 'network_error':
      return `[SYSTEM] 网络连接错误（${errorMsg?.slice(0, 100) ?? '未知'}），请重试。`;
    case 'unknown':
      return `[SYSTEM] 请求异常（${errorMsg?.slice(0, 100) ?? '未知'}），请重试。`;
    // C1：非法工具参数 → 提示重新输出合法 JSON
    case 'invalid_tool_arguments':
      return '[SYSTEM] 工具调用参数无效（JSON 解析失败）。请重新输出 tool_calls，确保每个 arguments 都是合法 JSON，且字段与 schema 一致。';
    // C1：prompt 超长 → 截头后重试
    case 'prompt_too_long':
      return '[SYSTEM] 上下文过长，已截断早期历史消息，请重试。';
    default:
      return '[SYSTEM] 请继续。';
  }
}

/** 日志用：按类型映射将返回的恢复动作（供 assess 日志记录） */
function recoveryActionForLog(type: RecoveryType): string {
  switch (type) {
    case 'context_overflow':
      return 'compact_and_retry';
    case 'invalid_tool_arguments':
      return 'retry_with_correction';
    case 'prompt_too_long':
      return 'truncate_head_and_retry';
    default:
      return 'retry';
  }
}

export class ErrorRecoveryManager {
  private attempts: Map<RecoveryType, RecoveryAttempt> = new Map();
  /** 单次尝试守卫：压缩是否已尝试过（防止压缩-重试死循环） */
  private _compactAttempted: boolean = false;
  /** C1：max_output 翻倍是否已尝试（单次，对标 PilotDeck max_output 单次翻倍重试） */
  private _maxOutputDoubled: boolean = false;

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

    // 2026-08-31（对标 hermes TurnRetryState）：本地确定性 bug 不重试——
    // 重试必然再次失败，只掩盖真实代码缺陷并浪费 token。直接 abort + 记录。
    if (type === 'unknown' && isDeterministicLocalError(error)) {
      logger.error('Recovery deterministic local error (no retry)', {
        name: error.name,
        message: error.message.slice(0, 200),
        turnCount: context.turnCount,
      });
      return {
        recovered: false,
        action: 'abort',
        message: `本地代码错误（${error.name}），不重试：${error.message.slice(0, 120)}`,
      };
    }

    let attempt = this.attempts.get(type);
    if (!attempt) {
      // 新增类型未在 attempts 中初始化 → 动态创建
      const newAttempt: RecoveryAttempt = {
        type,
        maxRetries: DEFAULT_MAX_RETRIES[type] ?? 2,
        retryCount: 0,
      };
      this.attempts.set(type, newAttempt);
      attempt = newAttempt;
    }

    // 单次尝试守卫：压缩只能尝试一次
    if (type === 'context_overflow' && this._compactAttempted) {
      logger.warn('Context overflow compact already attempted, aborting', {
        turnCount: context.turnCount,
      });
      return {
        recovered: false,
        action: 'abort',
        message: '上下文压缩已尝试过，放弃重试（防止压缩-重试死循环）',
      };
    }

    attempt.lastError = error;
    attempt.retryCount++;

    if (attempt.retryCount > attempt.maxRetries) {
      logger.warn('Recovery retry max exceeded', {
        type,
        retryCount: attempt.retryCount,
        maxRetries: attempt.maxRetries,
        turnCount: context.turnCount,
      });
      return {
        recovered: false,
        action: 'abort',
        message: `恢复尝试已超过最大次数 (${attempt.maxRetries})`,
      };
    }

    logger.info('Recovery action decided', {
      type,
      action: recoveryActionForLog(type),
      retryCount: attempt.retryCount,
      maxRetries: attempt.maxRetries,
      turnCount: context.turnCount,
    });

    switch (type) {
      case 'context_overflow':
        this._compactAttempted = true; // 标记压缩已尝试
        return {
          recovered: true,
          action: 'compact_and_retry',
          message: '上下文溢出，压缩后重试',
        };

      // C1：非法工具参数 → JSON 自纠错（重新输出合法参数）
      case 'invalid_tool_arguments':
        return {
          recovered: true,
          action: 'retry_with_correction',
          message: getRecoveryMessage(type, error.message),
        };

      // C1：prompt 超长 → 截头重试
      case 'prompt_too_long':
        return {
          recovered: true,
          action: 'truncate_head_and_retry',
          message: getRecoveryMessage(type, error.message),
        };

      // C1：max_output 首次翻倍输出上限（单次），之后降级 [SYSTEM] 提示
      case 'max_output':
        if (!this._maxOutputDoubled) {
          this._maxOutputDoubled = true;
          return {
            recovered: true,
            action: 'retry_higher_output',
            message: '[SYSTEM] 已提高输出上限，请继续未完成的回答。',
          };
        }
        return {
          recovered: true,
          action: 'retry',
          message: getRecoveryMessage(type),
        };

      case 'empty_response':
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

      case 'server_error':
      case 'rate_limit':
      case 'network_error':
      case 'unknown':
        return {
          recovered: true,
          action: 'retry',
          message: getRecoveryMessage(type, error.message),
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
    this._compactAttempted = false;
    this._maxOutputDoubled = false;
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
    return {
      attempts: entries,
      compactAttempted: this._compactAttempted,
      maxOutputDoubled: this._maxOutputDoubled,
    };
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
    this._compactAttempted = state.compactAttempted ?? false;
    this._maxOutputDoubled = state.maxOutputDoubled ?? false;
  }
}

/** 工厂函数 */
export function createErrorRecoveryManager(): ErrorRecoveryManager {
  return new ErrorRecoveryManager();
}
