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
 * P2-2.9: Span 去重注册表
 *
 * 消除 EventBusOTelBridge 与 SessionTracing 对同一操作创建双重 Span 的问题。
 * 通过约定分工 + 运行时 WeakMap 防御实现。
 *
 * 约定分工：
 *   - EventBusOTelBridge: dag.execute、dag.task（编排层）
 *   - SessionTracing: interaction、llm_request、tool.execute（交互层）
 *   - httpClient (前端): http:{METHOD}:{path}（传输层）
 *
 * 运行时机：调用方在 startSpan 前调用 dedupStartSpan，若同名 Span 已存在则跳过。
 */

import { Span, Tracer } from '@opentelemetry/api';
import { createLogger, LogLevel } from '@modules/monitoring';

const logger = createLogger({
  module: 'monitoring:tracing:dedup',
  level: LogLevel.DEBUG,
});

/**
 * 共享 WeakMap，记录已在父 Span 下创建的 Span 名。
 * 使用 WeakMap 确保父 Span 被 GC 回收后，覆盖记录自动清除。
 */
const spanCoverageMap = new WeakMap<Span, Set<string>>();

/**
 * 去重创建 Span
 *
 * 若 parentSpan 下已存在同名 Span，返回 undefined（调用方跳过）。
 * 否则创建新 Span，记录到覆盖注册表。
 *
 * @param parentSpan 父 Span（可为 undefined，此时直接创建 Span）
 * @param name      Span 名称
 * @param tracer    OTel Tracer
 * @returns 创建的 Span，或 undefined（重复 Span 已跳过）
 */
export function dedupStartSpan(
  parentSpan: Span | undefined,
  name: string,
  tracer: Tracer
): Span | undefined {
  if (!parentSpan) {
    return tracer.startSpan(name);
  }

  let covered = spanCoverageMap.get(parentSpan);
  if (!covered) {
    covered = new Set<string>();
    spanCoverageMap.set(parentSpan, covered);
  }

  if (covered.has(name)) {
    logger.debug(`跳过重复 Span: ${name}`);
    return undefined;
  }

  covered.add(name);
  return tracer.startSpan(name);
}

/**
 * 检查 Span 是否已在父 Span 下注册
 */
export function isSpanCovered(parentSpan: Span, name: string): boolean {
  const covered = spanCoverageMap.get(parentSpan);
  return covered?.has(name) ?? false;
}

/**
 * 标记 Span 已在父 Span 下创建
 */
export function markSpanCovered(parentSpan: Span, name: string): void {
  let covered = spanCoverageMap.get(parentSpan);
  if (!covered) {
    covered = new Set<string>();
    spanCoverageMap.set(parentSpan, covered);
  }
  covered.add(name);
}

/**
 * 清除指定父 Span 的覆盖记录（在父 Span 结束时调用）
 */
export function clearSpanCoverage(parentSpan: Span): void {
  spanCoverageMap.delete(parentSpan);
}
