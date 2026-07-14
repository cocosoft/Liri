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
 * LoopDetector — Agent 工具调用循环检测器
 *
 * Phase 1 新增。对标 openclaw tool-loop-detection.ts。
 * 提供两种检测器：通用重复检测（generic repeat）和乒乓交替检测（ping-pong）。
 * 检测结果分为 warning（仅记录）和 critical（阻断执行）两级。
 */

import { createHash } from 'node:crypto';

/** 检测器类型 */
type DetectorKind = 'generic_repeat' | 'ping_pong';

/** 检测结果 */
type LoopDetectionResult =
  | { stuck: false }
  | {
      stuck: true;
      level: 'warning' | 'critical';
      detector: DetectorKind;
      count: number;
      message: string;
    };

/** 检测器配置 */
interface LoopDetectorConfig {
  enabled: boolean;
  /** 滑动窗口大小，默认 15 */
  historySize: number;
  /** 通用警告阈值，默认 10 */
  warningThreshold: number;
  /** 阻断阈值，默认 20 */
  criticalThreshold: number;
  /** hash 输入最大长度（超过则先截断再 hash），默认 5000 */
  hashMaxInputLength: number;
  detectors: {
    /** 相同工具+相同参数的重复调用 */
    genericRepeat: boolean;
    /** 交替乒乓检测 */
    pingPong: boolean;
  };
}

/** 工具调用历史记录 */
interface ToolCallRecord {
  toolName: string;
  argsHash: string;
  toolCallId?: string;
  resultHash?: string;
  timestamp: number;
}

/** 默认配置 */
const DEFAULT_CONFIG: LoopDetectorConfig = {
  enabled: true,
  historySize: 15,
  warningThreshold: 10,
  criticalThreshold: 20,
  hashMaxInputLength: 5000,
  detectors: {
    genericRepeat: true,
    pingPong: true,
  },
};

/**
 * 确定性 JSON 序列化（对 object key 排序）
 * 确保相同逻辑内容的参数产生相同字符串
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value !== 'object') return JSON.stringify(value);

  if (Array.isArray(value)) {
    return '[' + value.map((v) => stableStringify(v)).join(',') + ']';
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`
  );
  return '{' + pairs.join(',') + '}';
}

/**
 * 对值做 SHA-256 hex digest
 */
function digestStable(value: unknown): string {
  const str = stableStringify(value);
  return createHash('sha256').update(str).digest('hex');
}

/**
 * 计算工具调用的参数 hash
 * 超过 hashMaxInputLength 的参数先截断
 */
function hashToolCall(
  toolName: string,
  params: unknown,
  hashMaxInputLength: number
): string {
  let input: unknown = params;

  // 性能优化：超大参数先截断
  const paramStr = stableStringify(params);
  if (paramStr.length > hashMaxInputLength) {
    const half = Math.floor(hashMaxInputLength / 2);
    input = {
      _truncated: true,
      _originalLength: paramStr.length,
      head: paramStr.slice(0, half),
      tail: paramStr.slice(-half),
    };
  }

  return `${toolName}:${digestStable(input)}`;
}

/**
 * 计算工具执行结果的 hash
 * 提取关键字段，忽略 PID 等易变字段
 */
function hashToolOutcome(result: unknown, error?: unknown): string {
  if (error !== undefined && error !== null) {
    const errStr = error instanceof Error ? error.message : String(error);
    return `error:${digestStable(errStr)}`;
  }

  if (result === null || result === undefined) {
    return 'null';
  }

  if (typeof result !== 'object') {
    return digestStable(result);
  }

  const obj = result as Record<string, unknown>;

  // 提取稳定字段做 hash
  const stable: Record<string, unknown> = {};

  if (typeof obj.status === 'string') stable.status = obj.status;
  if (typeof obj.exitCode === 'number') stable.exitCode = obj.exitCode;
  if (typeof obj.text === 'string') stable.text = obj.text;
  if (obj.details !== undefined) stable.details = obj.details;

  // 如果没有任何已知字段，退化为全量 hash
  if (Object.keys(stable).length === 0) {
    return digestStable(result);
  }

  return digestStable(stable);
}

export class LoopDetector {
  private config: LoopDetectorConfig;
  private history: ToolCallRecord[] = [];

  constructor(config?: Partial<LoopDetectorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (config?.detectors) {
      this.config.detectors = {
        ...DEFAULT_CONFIG.detectors,
        ...config.detectors,
      };
    }
  }

  /**
   * 工具调用前记录
   * 计算 argsHash，推入滑动窗口
   */
  recordToolCall(toolName: string, params: unknown, toolCallId?: string): void {
    if (!this.config.enabled) return;

    const argsHash = hashToolCall(
      toolName,
      params,
      this.config.hashMaxInputLength
    );

    this.history.push({
      toolName,
      argsHash,
      toolCallId,
      timestamp: Date.now(),
    });

    // 维护滑动窗口
    while (this.history.length > this.config.historySize) {
      this.history.shift();
    }
  }

  /**
   * 工具调用后记录执行结果
   * 计算 resultHash，匹配到之前的记录
   */
  recordToolCallOutcome(
    toolName: string,
    params: unknown,
    result: unknown,
    error?: unknown
  ): void {
    if (!this.config.enabled) return;

    const argsHash = hashToolCall(
      toolName,
      params,
      this.config.hashMaxInputLength
    );
    const resultHash = hashToolOutcome(result, error);

    // 从尾部向前匹配第一条未设置 resultHash 的记录
    for (let i = this.history.length - 1; i >= 0; i--) {
      const record = this.history[i];
      if (
        record.toolName === toolName &&
        record.argsHash === argsHash &&
        record.resultHash === undefined
      ) {
        record.resultHash = resultHash;
        return;
      }
    }

    // 如果未匹配到（异常情况），追加新记录
    this.history.push({
      toolName,
      argsHash,
      timestamp: Date.now(),
      resultHash,
    });
  }

  /**
   * 执行检测，返回是否卡死
   */
  detect(toolName: string, params: unknown): LoopDetectionResult {
    if (!this.config.enabled) return { stuck: false };
    if (this.history.length === 0) return { stuck: false };

    const argsHash = hashToolCall(
      toolName,
      params,
      this.config.hashMaxInputLength
    );

    // 工具名快速预检：该工具不足 2 次出现，不可能触发阈值
    const toolCount = this.history.filter(
      (h) => h.toolName === toolName
    ).length;
    if (toolCount < 2) return { stuck: false };

    // 1. Generic Repeat Detection
    if (this.config.detectors.genericRepeat) {
      const result = this._detectGenericRepeat(toolName, argsHash);
      if (result.stuck) return result;
    }

    // 2. Ping-Pong Detection
    if (this.config.detectors.pingPong) {
      const result = this._detectPingPong(toolName, argsHash);
      if (result.stuck) return result;
    }

    return { stuck: false };
  }

  /**
   * 通用重复检测：相同 toolName + argsHash 的连续重复次数
   */
  private _detectGenericRepeat(
    toolName: string,
    argsHash: string
  ): LoopDetectionResult {
    let count = 0;

    // 从尾部向前统计连续重复
    for (let i = this.history.length - 1; i >= 0; i--) {
      const record = this.history[i];
      if (record.toolName === toolName && record.argsHash === argsHash) {
        count++;
      } else {
        break;
      }
    }

    if (count >= this.config.criticalThreshold) {
      return {
        stuck: true,
        level: 'critical',
        detector: 'generic_repeat',
        count,
        message: `工具 "${toolName}" 连续重复 ${count} 次（临界阈值 ${this.config.criticalThreshold}），已阻断`,
      };
    }

    if (count >= this.config.warningThreshold) {
      return {
        stuck: true,
        level: 'warning',
        detector: 'generic_repeat',
        count,
        message: `工具 "${toolName}" 连续重复 ${count} 次（警告阈值 ${this.config.warningThreshold}）`,
      };
    }

    return { stuck: false };
  }

  /**
   * 乒乓检测：两个工具交替调用 A→B→A→B...
   */
  private _detectPingPong(
    toolName: string,
    argsHash: string
  ): LoopDetectionResult {
    if (this.history.length < 2) return { stuck: false };

    const last = this.history[this.history.length - 1];

    // 找到第一个不同的 argsHash（交替的另一方）
    let otherHash: string | null = null;
    let otherTool: string | null = null;

    for (let i = this.history.length - 2; i >= 0; i--) {
      const record = this.history[i];
      if (record.argsHash !== argsHash) {
        otherHash = record.argsHash;
        otherTool = record.toolName;
        break;
      }
    }

    if (!otherHash) return { stuck: false };

    // 从尾部统计交替次数
    let alternatingCount = 0;
    let expectCurrent = true; // true=当前方, false=交替另一方

    for (let i = this.history.length - 1; i >= 0; i--) {
      const record = this.history[i];
      const matchCurrent = record.argsHash === argsHash;
      const matchOther = record.argsHash === otherHash;

      if (expectCurrent && matchCurrent) {
        alternatingCount++;
        expectCurrent = false;
      } else if (!expectCurrent && matchOther) {
        expectCurrent = true;
      } else {
        break;
      }
    }

    if (alternatingCount < this.config.warningThreshold) {
      return { stuck: false };
    }

    // 检查 no-progress evidence：交替双方各自的 resultHash 是否始终一致
    const currentResults = new Set<string>();
    const otherResults = new Set<string>();

    for (let i = this.history.length - 1; i >= 0; i--) {
      const record = this.history[i];
      if (record.argsHash === argsHash && record.resultHash) {
        currentResults.add(record.resultHash);
      }
      if (record.argsHash === otherHash && record.resultHash) {
        otherResults.add(record.resultHash);
      }
    }

    const noProgress =
      currentResults.size <= 1 &&
      otherResults.size <= 1 &&
      currentResults.size + otherResults.size > 0;

    if (alternatingCount >= this.config.criticalThreshold && noProgress) {
      return {
        stuck: true,
        level: 'critical',
        detector: 'ping_pong',
        count: alternatingCount,
        message: `工具 "${toolName}" 与 "${otherTool}" 乒乓交替 ${alternatingCount} 次且无进展，已阻断`,
      };
    }

    if (alternatingCount >= this.config.warningThreshold) {
      return {
        stuck: true,
        level: 'warning',
        detector: 'ping_pong',
        count: alternatingCount,
        message: `工具 "${toolName}" 与 "${otherTool}" 乒乓交替 ${alternatingCount} 次（警告）`,
      };
    }

    return { stuck: false };
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalCalls: number;
    uniquePatterns: number;
    mostFrequent: Array<{ toolName: string; count: number }>;
  } {
    const totalCalls = this.history.length;

    const patternSet = new Set(
      this.history.map((r) => `${r.toolName}:${r.argsHash}`)
    );
    const uniquePatterns = patternSet.size;

    const toolCounts = new Map<string, number>();
    for (const record of this.history) {
      toolCounts.set(
        record.toolName,
        (toolCounts.get(record.toolName) ?? 0) + 1
      );
    }
    const mostFrequent = Array.from(toolCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([toolName, count]) => ({ toolName, count }));

    return { totalCalls, uniquePatterns, mostFrequent };
  }

  /**
   * 重置历史记录
   */
  reset(): void {
    this.history = [];
  }
}

/** 工厂函数 */
export function createLoopDetector(
  config?: Partial<LoopDetectorConfig>
): LoopDetector {
  return new LoopDetector(config);
}
