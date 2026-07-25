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
 * Phase 2 增强：新增 unknown_tool_repeat、unknown_tool_aggregate、no_tool_call 检测。
 * 检测结果分为 warning（仅记录）和 critical（阻断执行）两级。
 */

import { createHash } from 'node:crypto';
import {
  LOOP_UNKNOWN_TOOL_WARNING,
  LOOP_UNKNOWN_TOOL_CRITICAL,
  LOOP_GENERIC_REPEAT_WARNING,
  LOOP_GENERIC_REPEAT_CRITICAL,
  LOOP_PING_PONG_THRESHOLD,
  LOOP_NO_TOOL_CALL_WARNING,
  LOOP_NO_TOOL_CALL_CRITICAL,
} from './loop-config.js';
import { Logger } from '@modules/monitoring';

const logger = new Logger({ module: 'query:loopDetector' });

/** 检测器类型 */
type DetectorKind =
  | 'generic_repeat'
  | 'ping_pong'
  | 'unknown_tool_repeat'
  | 'unknown_tool_aggregate'
  | 'no_tool_call';

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
    /** 未知工具重复检测 */
    unknownToolRepeat: boolean;
    /** 未知工具聚合检测 */
    unknownToolAggregate: boolean;
  };
  /** 未知工具警告阈值，默认 5 */
  unknownToolWarningThreshold: number;
  /** 未知工具阻断阈值，默认 10 */
  unknownToolCriticalThreshold: number;
  /** 聚合检测窗口大小，默认 20 */
  unknownToolAggregateWindow: number;
  /** 聚合比例阈值，默认 0.5（50%） */
  unknownToolAggregateRatio: number;
  /** ping_pong 交替次数阈值，默认 10 */
  pingPongThreshold: number;
}

/** 工具调用历史记录 */
interface ToolCallRecord {
  toolName: string;
  argsHash: string;
  toolCallId?: string;
  resultHash?: string;
  timestamp: number;
  /** 工具是否存在（false = 模型调用了不存在的工具） */
  toolExists?: boolean;
}

/** 默认配置 */
const DEFAULT_CONFIG: LoopDetectorConfig = {
  enabled: true,
  historySize: 15,
  /** generic_repeat 警告/阻断阈值（可通过 LOOP_GENERIC_REPEAT_* 环境变量覆盖） */
  warningThreshold: LOOP_GENERIC_REPEAT_WARNING,
  criticalThreshold: LOOP_GENERIC_REPEAT_CRITICAL,
  hashMaxInputLength: 5000,
  detectors: {
    genericRepeat: true,
    pingPong: true,
    unknownToolRepeat: true,
    unknownToolAggregate: true,
  },
  /** unknown_tool_repeat 阈值（可通过 LOOP_UNKNOWN_TOOL_* 环境变量覆盖） */
  unknownToolWarningThreshold: LOOP_UNKNOWN_TOOL_WARNING,
  unknownToolCriticalThreshold: LOOP_UNKNOWN_TOOL_CRITICAL,
  unknownToolAggregateWindow: 20,
  unknownToolAggregateRatio: 0.5,
  /** ping_pong 交替次数阈值（可通过 LOOP_PING_PONG_THRESHOLD 环境变量覆盖） */
  pingPongThreshold: LOOP_PING_PONG_THRESHOLD,
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
  /** 纯文本死循环检测：连续无工具调用轮次计数 */
  private noToolCallStreak: number = 0;
  /** no_tool_call 警告阈值（可通过 LOOP_NO_TOOL_CALL_WARNING 环境变量覆盖） */
  private readonly NO_TOOL_CALL_WARNING = LOOP_NO_TOOL_CALL_WARNING;
  /** no_tool_call 阻断阈值（可通过 LOOP_NO_TOOL_CALL_CRITICAL 环境变量覆盖） */
  private readonly NO_TOOL_CALL_CRITICAL = LOOP_NO_TOOL_CALL_CRITICAL;

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
      toolExists: true,
    });

    // 维护滑动窗口
    while (this.history.length > this.config.historySize) {
      this.history.shift();
    }
  }

  /**
   * 记录模型调用了不存在的工具（工具注册表中未找到）
   * 这通常是模型幻觉或循环退化的信号
   */
  recordUnknownTool(toolName: string, params: unknown): void {
    if (!this.config.enabled) return;

    const argsHash = hashToolCall(
      toolName,
      params,
      this.config.hashMaxInputLength
    );

    this.history.push({
      toolName,
      argsHash,
      timestamp: Date.now(),
      toolExists: false,
    });

    while (this.history.length > this.config.historySize) {
      this.history.shift();
    }
  }

  /**
   * 记录一轮结束（Phase 2 no_tool_call 检测）
   * @param hasToolCalls 本轮是否有工具调用
   */
  recordTurn(hasToolCalls: boolean): void {
    if (!hasToolCalls) {
      this.noToolCallStreak++;
    } else {
      this.noToolCallStreak = 0;
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

    // 自动记录此次调用（已知工具）
    this.recordToolCall(toolName, params);

    if (this.history.length === 0) return { stuck: false };

    const argsHash = hashToolCall(
      toolName,
      params,
      this.config.hashMaxInputLength
    );

    // 0. Unknown Tool Repeat Detection（优先级最高）
    if (this.config.detectors.unknownToolRepeat) {
      const result = this._detectUnknownToolRepeat(toolName);
      if (result.stuck) {
        this.logDetection(result);
        return result;
      }
    }

    // 0.1. Unknown Tool Aggregate Detection（交替假工具场景）
    if (this.config.detectors.unknownToolAggregate) {
      const aggResult = this._detectUnknownToolAggregate();
      if (aggResult.stuck) {
        this.logDetection(aggResult);
        return aggResult;
      }
    }

    // 工具名快速预检：该工具不足 2 次出现，不可能触发阈值
    const toolCount = this.history.filter(
      (h) => h.toolName === toolName
    ).length;
    if (toolCount < 2) return { stuck: false };

    // 1. Generic Repeat Detection
    if (this.config.detectors.genericRepeat) {
      const result = this._detectGenericRepeat(toolName, argsHash);
      if (result.stuck) {
        this.logDetection(result);
        return result;
      }
    }

    // 2. Ping-Pong Detection
    if (this.config.detectors.pingPong) {
      const result = this._detectPingPong(toolName, argsHash);
      if (result.stuck) {
        this.logDetection(result);
        return result;
      }
    }

    return { stuck: false };
  }

  /**
   * 纯文本死循环检测（Phase 2）
   * 连续多轮无工具调用，可能陷入纯文本循环
   */
  detectNoToolCallLoop(): LoopDetectionResult {
    if (this.noToolCallStreak >= this.NO_TOOL_CALL_CRITICAL) {
      const result: LoopDetectionResult = {
        stuck: true,
        level: 'critical',
        detector: 'no_tool_call',
        count: this.noToolCallStreak,
        message: `连续 ${this.noToolCallStreak} 轮无工具调用，可能陷入纯文本死循环，已阻断`,
      };
      this.logDetection(result);
      return result;
    }
    if (this.noToolCallStreak >= this.NO_TOOL_CALL_WARNING) {
      const result: LoopDetectionResult = {
        stuck: true,
        level: 'warning',
        detector: 'no_tool_call',
        count: this.noToolCallStreak,
        message: `连续 ${this.noToolCallStreak} 轮无工具调用（警告）`,
      };
      this.logDetection(result);
      return result;
    }
    return { stuck: false };
  }

  /**
   * 记录检测结果日志
   */
  private logDetection(result: LoopDetectionResult & { stuck: true }): void {
    const logData = {
      detector: result.detector,
      level: result.level,
      count: result.count,
      message: result.message,
    };
    if (result.level === 'critical') {
      logger.error('Loop detected (critical)', logData);
    } else {
      logger.warn('Loop detected (warning)', logData);
    }
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

    if (alternatingCount < this.config.pingPongThreshold) {
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
   * 未知工具重复检测：对不存在的工具连续调用
   * 模型反复调用同一个不存在的工具 → 无限死循环信号
   */
  private _detectUnknownToolRepeat(toolName: string): LoopDetectionResult {
    let count = 0;

    // 从尾部统计连续（仅统计 toolExists === false 的连续段）
    for (let i = this.history.length - 1; i >= 0; i--) {
      const record = this.history[i];
      if (record.toolName === toolName && record.toolExists === false) {
        count++;
      } else {
        break; // 任何打断（不同工具名 / 同工具但存在）都停止
      }
    }

    if (count >= this.config.unknownToolCriticalThreshold) {
      return {
        stuck: true,
        level: 'critical',
        detector: 'unknown_tool_repeat',
        count,
        message: `工具 "${toolName}" 不存在，但被连续调用 ${count} 次（临界阈值 ${this.config.unknownToolCriticalThreshold}），已阻断`,
      };
    }

    if (count >= this.config.unknownToolWarningThreshold) {
      return {
        stuck: true,
        level: 'warning',
        detector: 'unknown_tool_repeat',
        count,
        message: `工具 "${toolName}" 不存在，连续调用 ${count} 次（警告阈值 ${this.config.unknownToolWarningThreshold}）`,
      };
    }

    return { stuck: false };
  }

  /**
   * 未知工具聚合检测（Phase 2 新增）
   * 统计最近 N 轮中不存在的工具占总调用比例，超过阈值触发阻断。
   * 解决「交替假工具」死循环问题——3 个假工具交替调用，单个不超阈值。
   */
  private _detectUnknownToolAggregate(): LoopDetectionResult {
    const recent = this.history.slice(-this.config.unknownToolAggregateWindow);
    if (recent.length < 10) return { stuck: false };

    const unknownCount = recent.filter((h) => h.toolExists === false).length;
    const ratio = unknownCount / recent.length;

    if (ratio > this.config.unknownToolAggregateRatio && unknownCount >= 6) {
      return {
        stuck: true,
        level: 'critical',
        detector: 'unknown_tool_aggregate',
        count: unknownCount,
        message: `最近 ${recent.length} 次工具调用中 ${unknownCount} 次不存在 (${Math.round(ratio * 100)}%)，可能处于幻觉循环`,
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
    this.noToolCallStreak = 0;
  }

  /**
   * 获取可序列化的状态（用于检查点持久化）
   */
  getState(): { noToolCallStreak: number } {
    return { noToolCallStreak: this.noToolCallStreak };
  }

  /**
   * 从检查点恢复状态
   */
  restoreState(s: ReturnType<LoopDetector['getState']>): void {
    this.noToolCallStreak = s.noToolCallStreak;
  }
}

/** 工厂函数 */
export function createLoopDetector(
  config?: Partial<LoopDetectorConfig>
): LoopDetector {
  return new LoopDetector(config);
}
