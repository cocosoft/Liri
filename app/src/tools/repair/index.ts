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
 * 工具调用修复管道 (ToolCallRepair)
 *
 * 四阶段管道，按顺序修复模型返回的工具调用：
 *   1. Flatten  — 展平深层嵌套 schema，调用后重新嵌套
 *   2. Scavenge — 从 reasoning_content 中回收泄漏的工具调用
 *   3. Truncation — 修复被截断的 JSON 参数
 *   4. Storm    — 检测并抑制重复调用循环
 *
 * 借鉴: DeepSeek-Reasonix src/repair/index.ts
 */

import { Logger } from '@modules/monitoring/logs/Logger';
import { analyzeSchema, flattenSchema, nestArguments } from './flatten';
import { scavengeToolCalls } from './scavenge';
import { repairTruncatedJson } from './truncation';
import { StormBreaker } from './storm';
import type {
  JSONSchema,
  ToolCall,
  ScavengeOptions,
  RepairConfig,
  RepairResult,
} from './types';

const logger = new Logger();

/**
 * 工具调用修复管道
 */
export class ToolCallRepair {
  private readonly config: Required<
    Omit<RepairConfig, 'isMutating' | 'isStormExempt'>
  >;
  private readonly stormBreaker: StormBreaker;
  private readonly isMutating?: (call: ToolCall) => boolean;
  private readonly isStormExempt?: (call: ToolCall) => boolean;

  constructor(config: RepairConfig = {}) {
    this.config = {
      flatten: config.flatten ?? true,
      scavenge: config.scavenge ?? true,
      truncation: config.truncation ?? true,
      storm: config.storm ?? true,
      stormWindowSize: config.stormWindowSize ?? 6,
      stormThreshold: config.stormThreshold ?? 3,
    };
    this.isMutating = config.isMutating;
    this.isStormExempt = config.isStormExempt;
    this.stormBreaker = new StormBreaker(
      this.config.stormWindowSize,
      this.config.stormThreshold,
      this.isMutating,
      this.isStormExempt
    );
  }

  /**
   * 处理模型响应的工具调用
   *
   * @param calls - 原始工具调用列表
   * @param reasoningContent - 模型的 reasoning_content（用于 scavenge）
   * @param allowedNames - 允许的工具名称集合
   * @returns 修复后的调用和统计信息
   */
  process(
    calls: ToolCall[],
    reasoningContent: string | null | undefined,
    allowedNames: ReadonlySet<string>
  ): RepairResult {
    const notes: string[] = [];
    const stats = {
      flattenApplied: false,
      scavengedCount: 0,
      truncationFixed: 0,
      stormSuppressed: 0,
    };

    let processed = calls;

    // 阶段 1: Truncation — 修复每个调用中截断的 JSON 参数
    if (this.config.truncation) {
      processed = processed.map((call) => {
        const args = call.function?.arguments;
        if (!args || typeof args !== 'string') return call;
        const result = repairTruncatedJson(args);
        if (result.changed) {
          stats.truncationFixed++;
          notes.push(...result.notes.map((n) => `truncation fix: ${n}`));
          return {
            ...call,
            function: {
              ...call.function!,
              arguments: result.repaired,
            },
          };
        }
        return call;
      });
    }

    // 阶段 2: Scavenge — 从 reasoning_content 中回收额外调用
    // 仅当原始调用为空或很少时激活
    if (this.config.scavenge) {
      const scavengeOpts: ScavengeOptions = {
        allowedNames,
        maxCalls: Math.max(0, 4 - processed.length),
      };
      const scavenged = scavengeToolCalls(reasoningContent, scavengeOpts);
      if (scavenged.calls.length > 0) {
        // 仅添加签名不与已有调用重复的
        const existingSignatures = new Set(
          processed.map((c) => `${c.function?.name}:${c.function?.arguments}`)
        );
        for (const call of scavenged.calls) {
          const sig = `${call.function?.name}:${call.function?.arguments}`;
          if (!existingSignatures.has(sig)) {
            processed.push(call);
            existingSignatures.add(sig);
            stats.scavengedCount++;
          }
        }
        notes.push(...scavenged.notes);
      }
    }

    // 阶段 3: Storm — 检测重复调用循环
    if (this.config.storm) {
      const filtered: ToolCall[] = [];
      for (const call of processed) {
        const result = this.stormBreaker.inspect(call);
        if (result.suppress) {
          stats.stormSuppressed++;
          notes.push(result.reason ?? 'storm suppressed');
          logger.warn('StormBreaker suppressed call', {
            name: call.function?.name,
            reason: result.reason,
          });
        } else {
          filtered.push(call);
        }
      }
      processed = filtered;
    }

    return { calls: processed, notes, stats };
  }

  /**
   * 准备工具 schema 发送给模型
   *
   * 对需要展平的 schema（深层嵌套），返回展平后的版本。
   * 调用方需要记录 flatten 映射，以便在 dispatch 时重新嵌套参数。
   */
  prepareSchema(
    name: string,
    schema: JSONSchema
  ): { schema: JSONSchema; flattened: boolean } {
    if (!this.config.flatten) return { schema, flattened: false };
    const decision = analyzeSchema(schema);
    if (!decision.shouldFlatten) return { schema, flattened: false };
    logger.debug('Flattening tool schema', {
      name,
      leafCount: decision.leafCount,
      maxDepth: decision.maxDepth,
    });
    return { schema: flattenSchema(schema), flattened: true };
  }

  /**
   * 重新嵌套展平后的参数
   */
  renestArgs(
    args: Record<string, unknown>,
    wasFlattened: boolean
  ): Record<string, unknown> {
    if (!wasFlattened) return args;
    return nestArguments(args);
  }

  /**
   * 重置风暴检测器状态
   */
  resetStorm(): void {
    this.stormBreaker.reset();
  }

  /**
   * 检查 JSON 字符串是否完整可解析
   */
  static isCompleteJson(s: string): boolean {
    if (!s || !s.trim()) return false;
    try {
      JSON.parse(s);
      return true;
    } catch {
      return false;
    }
  }
}

// ─── 便捷导出 ────────────────────────────────────────────────────────────────

export { analyzeSchema, flattenSchema, nestArguments } from './flatten';
export { scavengeToolCalls } from './scavenge';
export { repairTruncatedJson } from './truncation';
export { StormBreaker } from './storm';
export type {
  JSONSchema,
  ToolCall,
  ScavengeOptions,
  ScavengeResult,
  TruncationRepairResult,
  FlattenDecision,
  RepairConfig,
  RepairResult,
} from './types';
