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
 * AI遥测类型定义
 */

export interface APIUsageMetrics {
  requestId: string;
  model: string;
  latency: number; // 耗时(ms)
  promptTokens: number; // 输入Token数
  completionTokens: number; // 输出Token数
  totalTokens: number; // 总Token数
  error?: string; // 错误信息
  statusCode?: number; // HTTP状态码
  timestamp: number; // 时间戳
  requestType: string; // 请求类型
}

export interface TelemetryConfig {
  enabled: boolean;
  samplingRate: number; // 采样率 0-1
  exportMetrics: boolean; // 是否导出指标
  exportTraces: boolean; // 是否导出追踪
}

export interface SpanContext {
  traceId: string;
  spanId: string;
  isSampled: boolean;
}

export interface AITraceData {
  spanContext: SpanContext;
  startTime: number;
  endTime?: number;
  attributes: Record<string, unknown>;
  events: TraceEvent[];
}

export interface TraceEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
}
