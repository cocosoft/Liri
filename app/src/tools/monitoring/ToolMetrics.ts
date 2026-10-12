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
 * ToolMetrics — 工具调用可观测性指标（S2-6，2026-10-11）
 *
 * 补齐工具链"指标"空白（此前只有 `SmartToolIntegrator` 的**进程内内存**统计
 * （`getMetrics()`，按 tool 计数/平均耗时，无标签、不桥接 OTel）与每工具 OTel span）：
 *  - **① 统一工具调用指标**：`tools.invocation.*`（工具名 / 结果 / 耗时 / 入参字节 / 估算 tokens）；
 *  - **② Tool-Use Context Entropy**：`tools.schema.*`（工具 Schema 占上下文窗口的物理比例 %）；
 *  - **③ 工具误调用率**：由 ① 的 `result=ok|error` 计数**派生**（`error/total`）—— 不经
 *    错误文案字符串分类（CS02：状态判定禁止字符串匹配），故不单列指标。
 *
 * 模式对齐 `channels/monitoring/ChannelMetrics.ts`：按维度**懒建** counter/histogram 并缓存
 * （避免每次调用重建指标实例导致计数被重置）；指标经 `MetricsService` 统一管理，
 * 由 `AppCoreOTelHelper` 的 `MetricsBridge` 桥接 OTel。
 */

import { getLogger, getMetricsService } from '@modules/monitoring';
import type {
  CounterMetric,
  GaugeMetric,
  HistogramMetric,
} from '@modules/monitoring';

const logger = getLogger('tools:metrics');

/**
 * TG-5（2026-10-12 裁断）：「工具 Schema 混沌」告警阈值 —— 长程第 N 轮之后。
 * 判据（方案 §4 观测项）：长程任务第 20 轮后工具 Schema 仍占 >30% token。
 */
export const SCHEMA_ENTROPY_TURN_THRESHOLD = 20;
/** 工具 Schema 占上下文窗口的物理比例上限（%）—— 超过即告警 */
export const SCHEMA_ENTROPY_PERCENT_THRESHOLD = 30;

/** 一次工具调用的观测量（字段缺省 ⇒ 不记录对应指标，不臆造，CS06） */
export interface ToolInvocationMetric {
  toolName: string;
  durationMs: number;
  success: boolean;
  /** 入参 JSON 字节数（可选） */
  inputBytes?: number;
  /** 入参估算 tokens（可选） */
  estimatedTokens?: number;
}

/** 一轮"工具 Schema 占上下文"的观测量（S2-6 ②） */
export interface ToolSchemaEntropyMetric {
  toolCount: number;
  schemaTokens: number;
  /** 模型上下文窗口（tokens）；`undefined` ⇒ 只记绝对值，不算比例（不臆造） */
  contextWindowTokens?: number;
  /** 本轮序号（长程任务轮次，1-based）；`undefined` ⇒ 不做 TG-5 阈值告警 */
  turn?: number;
}

/** TG-5 熵门禁裁决（纯判定，**不阻断** —— Fail-Open for Observation） */
export interface SchemaEntropyGateVerdict {
  /** 是否触发告警（= 已达轮次阈值 **且** 比例超限） */
  warn: boolean;
  turn: number;
  percent: number;
  reason: 'warn' | 'turn_below_threshold' | 'percent_below_threshold';
}

/**
 * TG-5（2026-10-12 裁断）：工具 Schema 熵阈值判定（**纯函数**，零副作用）。
 *
 * 计入判定的前提：`turn` 与 `contextWindowTokens` **均已提供**（缺任一 ⇒ 返回 `null`，不臆造）。
 * 规则：`turn >= 20` **且** `schemaTokens / contextWindowTokens > 30%` ⇒ `warn=true`。
 * **只告警不阻断**（Fail-Open for Observation）；累积实测后再评估是否触发 D4/T2。
 */
export function evaluateSchemaEntropyGate(
  m: ToolSchemaEntropyMetric
): SchemaEntropyGateVerdict | null {
  if (
    m.turn === undefined ||
    !m.contextWindowTokens ||
    m.contextWindowTokens <= 0
  ) {
    return null;
  }
  const percent = (m.schemaTokens / m.contextWindowTokens) * 100;
  if (m.turn < SCHEMA_ENTROPY_TURN_THRESHOLD) {
    return {
      warn: false,
      turn: m.turn,
      percent,
      reason: 'turn_below_threshold',
    };
  }
  if (percent <= SCHEMA_ENTROPY_PERCENT_THRESHOLD) {
    return {
      warn: false,
      turn: m.turn,
      percent,
      reason: 'percent_below_threshold',
    };
  }
  return { warn: true, turn: m.turn, percent, reason: 'warn' };
}

/** 按 `tool:result` 懒建的工具调用计数缓存 */
const _invocationCounters = new Map<string, CounterMetric>();
/** 按 tool 懒建的耗时直方图缓存 */
const _durationHistograms = new Map<string, HistogramMetric>();
/** 按 tool 懒建的入参字节直方图缓存 */
const _inputBytesHistograms = new Map<string, HistogramMetric>();
/** 按 tool 懒建的入参估算 tokens 直方图缓存 */
const _inputTokensHistograms = new Map<string, HistogramMetric>();

let _schemaTokensHistogram: HistogramMetric | undefined;
let _entropyGauge: GaugeMetric | undefined;

function invocationCounter(toolName: string, success: boolean): CounterMetric {
  const result = success ? 'ok' : 'error';
  const key = `${toolName}:${result}`;
  let counter = _invocationCounters.get(key);
  if (!counter) {
    counter = getMetricsService().createCounter({
      name: 'tools.invocation.total',
      description: `工具调用总数（${toolName}/${result}）`,
      labels: { module: 'tools', tool: toolName, result },
    });
    _invocationCounters.set(key, counter);
  }
  return counter;
}

function durationHistogram(toolName: string): HistogramMetric {
  let histogram = _durationHistograms.get(toolName);
  if (!histogram) {
    histogram = getMetricsService().createHistogram({
      name: 'tools.invocation.duration_ms',
      description: `工具调用耗时（${toolName}，ms）`,
      labels: { module: 'tools', tool: toolName },
    });
    _durationHistograms.set(toolName, histogram);
  }
  return histogram;
}

function inputBytesHistogram(toolName: string): HistogramMetric {
  let histogram = _inputBytesHistograms.get(toolName);
  if (!histogram) {
    histogram = getMetricsService().createHistogram({
      name: 'tools.invocation.input_bytes',
      description: `工具入参字节数（${toolName}）`,
      labels: { module: 'tools', tool: toolName },
    });
    _inputBytesHistograms.set(toolName, histogram);
  }
  return histogram;
}

function inputTokensHistogram(toolName: string): HistogramMetric {
  let histogram = _inputTokensHistograms.get(toolName);
  if (!histogram) {
    histogram = getMetricsService().createHistogram({
      name: 'tools.invocation.estimated_tokens',
      description: `工具入参估算 tokens（${toolName}）`,
      labels: { module: 'tools', tool: toolName },
    });
    _inputTokensHistograms.set(toolName, histogram);
  }
  return histogram;
}

/**
 * 记录一次工具调用（在工具执行的**统一出口**调用 ⇒ 一处插桩覆盖全部路径）。
 *
 * 误调用率 = `tools.invocation.total{tool,result=error}` / 同 tool 的 total 之和（派生，无需额外分类）。
 */
export function recordToolInvocation(m: ToolInvocationMetric): void {
  invocationCounter(m.toolName, m.success).inc();
  durationHistogram(m.toolName).observe(m.durationMs);
  if (m.inputBytes !== undefined) {
    inputBytesHistogram(m.toolName).observe(m.inputBytes);
  }
  if (m.estimatedTokens !== undefined) {
    inputTokensHistogram(m.toolName).observe(m.estimatedTokens);
  }
}

/**
 * 记录一轮"工具 Schema 占上下文"观测（Tool-Use Context Entropy，S2-6 ②）。
 *
 * 判据（方案 §4 观测项）：长程任务第 20 轮后工具 Schema 仍占 >30% token ⇒ 可跳过争论直接
 * 上 Top-K 或 VFS 收口。`contextWindowTokens` 缺省 ⇒ 只记 `tools.schema.tokens`，不算比例。
 */
export function recordToolSchemaEntropy(
  m: ToolSchemaEntropyMetric
): SchemaEntropyGateVerdict | null {
  _schemaTokensHistogram ??= getMetricsService().createHistogram({
    name: 'tools.schema.tokens',
    description: '每轮传给模型的工具 Schema 估算 tokens',
    labels: { module: 'tools' },
  });
  _schemaTokensHistogram.observe(m.schemaTokens);

  if (m.contextWindowTokens && m.contextWindowTokens > 0) {
    _entropyGauge ??= getMetricsService().createGauge({
      name: 'tools.schema.context_entropy_percent',
      description:
        '最近一轮工具 Schema 占模型上下文窗口的物理比例（%）—— Tool-Use Context Entropy',
      labels: { module: 'tools' },
    });
    _entropyGauge.set((m.schemaTokens / m.contextWindowTokens) * 100);
  }

  // TG-5（2026-10-12 裁断）：长程「工具 Schema 混沌」阈值告警 —— **只告警、绝不阻断**
  // （Fail-Open for Observation）。判据/阈值见 `evaluateSchemaEntropyGate`；缺 `turn` 或
  // 上下文窗口 ⇒ 返回 `null`（不臆造）。累积实测后再评估是否触发 D4/T2。
  const verdict = evaluateSchemaEntropyGate(m);
  if (verdict?.warn) {
    logger.warn('tools:schema.entropy_high', {
      turn: verdict.turn,
      percent: Number(verdict.percent.toFixed(2)),
      percentThreshold: SCHEMA_ENTROPY_PERCENT_THRESHOLD,
      turnThreshold: SCHEMA_ENTROPY_TURN_THRESHOLD,
      toolCount: m.toolCount,
      schemaTokens: m.schemaTokens,
    });
  }
  // T3-12（2026-10-13）：把裁决**如实返回**给调用点 —— 由调用点（stream 链）在
  // `GUARD_SUSPEND` 开时决定是否接通 guard 挂起（本模块**不**做挂起，保持 tools 域无 query 依赖）。
  return verdict;
}

/** 仅测试用：清空懒建缓存（使下一次记录重建指标实例），并移除"值型"gauge 的残留 */
export function resetToolMetricsForTest(): void {
  _invocationCounters.clear();
  _durationHistograms.clear();
  _inputBytesHistograms.clear();
  _inputTokensHistograms.clear();
  _schemaTokensHistogram = undefined;
  _entropyGauge = undefined;
  // counter/histogram 会在下次记录时**重建并覆盖**同名条目（值归零）；gauge 不重建就仍留旧值
  // ⇒ 显式删除，保证测试隔离（仅测试辅助，非生产路径）。
  getMetricsService().deleteMetric('tools.schema.context_entropy_percent', {
    module: 'tools',
  });
}
