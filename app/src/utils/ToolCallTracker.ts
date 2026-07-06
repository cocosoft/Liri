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
 * ToolCallTracker — 工具调用跟踪与熔断检测
 *
 * 按"工具名称 + 参数哈希"粒度独立跟踪每次工具调用的成功/失败。
 * 同一工具+参数组合连续失败超过阈值时触发熔断，
 * 防止 Agent 在确定性失败上反复重试（如配置缺失的 Provider）。
 *
 * 不同工具或不同参数的失败互相独立，不交叉影响。
 */

/** 单条工具调用跟踪记录 */
interface ToolCallRecord {
  /** 工具名称 */
  toolName: string;

  /** 参数哈希（工具名+参数 JSON 的哈希，用于去重） */
  paramsHash: string;

  /** 首次调用时间戳 */
  firstCalledAt: number;

  /** 总调用次数 */
  totalCalls: number;

  /** 连续失败次数 */
  failures: number;

  /** 最近一次错误信息 */
  lastError: string;
}

/** 熔断检查结果 */
export interface CircuitBreakResult {
  /** 是否触发熔断 */
  break: boolean;

  /** 熔断原因（仅 break=true 时有值） */
  reason?: string;
}

export class ToolCallTracker {
  private records = new Map<string, ToolCallRecord>();

  /** 同一工具+参数组合连续失败多少次后触发熔断 */
  private readonly MAX_RETRIES_PER_KEY = 3;

  /**
   * 记录一次工具调用结果
   *
   * @param toolName 工具名称
   * @param params 工具参数
   * @param success 是否成功
   * @param error 失败时的错误信息
   */
  record(toolName: string, params: unknown, success: boolean, error?: string): void {
    const key = this.hashKey(toolName, params);

    if (!this.records.has(key)) {
      this.records.set(key, {
        toolName,
        paramsHash: key,
        firstCalledAt: Date.now(),
        totalCalls: 0,
        failures: 0,
        lastError: '',
      });
    }

    const record = this.records.get(key)!;
    record.totalCalls++;

    if (success) {
      // 成功时只清零该工具+参数组合的错误计数
      record.failures = 0;
    } else {
      record.failures++;
      record.lastError = error || '未知错误';
    }
  }

  /**
   * 检查是否应触发熔断
   *
   * @param toolName 工具名称
   * @param params 工具参数
   * @returns 熔断检查结果
   */
  shouldCircuitBreak(toolName: string, params: unknown): CircuitBreakResult {
    const key = this.hashKey(toolName, params);
    const record = this.records.get(key);

    if (record && record.failures >= this.MAX_RETRIES_PER_KEY) {
      return {
        break: true,
        reason:
          `该操作（${toolName}）已连续失败 ${record.failures} 次，` +
          `最近错误: ${record.lastError}。请检查配置或换用其他方式。`,
      };
    }

    return { break: false };
  }

  /**
   * 清除指定工具+参数组合的跟踪记录
   *
   * @param toolName 工具名称
   * @param params 工具参数
   */
  clear(toolName: string, params: unknown): void {
    const key = this.hashKey(toolName, params);
    this.records.delete(key);
  }

  /** 重置所有跟踪记录 */
  reset(): void {
    this.records.clear();
  }

  /** 获取当前跟踪记录数量 */
  get size(): number {
    return this.records.size;
  }

  /**
   * 生成工具名+参数的哈希键
   * 按 key 排序后序列化参数，保证相同参数不同顺序仍去重
   */
  private hashKey(toolName: string, params: unknown): string {
    const paramsStr = JSON.stringify(
      params ?? {},
      Object.keys((params as Record<string, unknown>) ?? {}).sort()
    );
    return `${toolName}:${simpleHash(paramsStr)}`;
  }
}

/** 简单字符串哈希（不引入外部依赖） */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
