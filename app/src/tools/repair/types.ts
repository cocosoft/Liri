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
 * 工具调用修复管道 — 共享类型定义
 * 借鉴 DeepSeek-Reasonix repair 模块设计
 */

/** 简化 JSON Schema 类型 */
export interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  description?: string;
  enum?: unknown[];
  [key: string]: unknown;
}

/** 工具调用结构 */
export interface ToolCall {
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
  index?: number;
}

/** 聊天消息 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  reasoning_content?: string | null;
}

/** Flatten 决策结果 */
export interface FlattenDecision {
  shouldFlatten: boolean;
  leafCount: number;
  maxDepth: number;
}

/** Scavenge 输入选项 */
export interface ScavengeOptions {
  allowedNames: ReadonlySet<string>;
  maxCalls?: number;
}

/** Scavenge 结果 */
export interface ScavengeResult {
  calls: ToolCall[];
  notes: string[];
}

/** Truncation 修复结果 */
export interface TruncationRepairResult {
  repaired: string;
  changed: boolean;
  notes: string[];
  fallback: boolean;
}

/** Storm 抑制结果 */
export interface StormResult {
  suppress: boolean;
  reason?: string;
}

/** 工具调用修复管道配置 */
export interface RepairConfig {
  /** 是否启用 schema flatten */
  flatten?: boolean;
  /** 是否启用 scavenge 回收 */
  scavenge?: boolean;
  /** 是否启用截断修复 */
  truncation?: boolean;
  /** 是否启用风暴检测 */
  storm?: boolean;
  /** 风暴检测窗口大小 */
  stormWindowSize?: number;
  /** 风暴检测阈值 */
  stormThreshold?: number;
  /** 是否为变更性工具调用（用于风暴检测清理只读记录） */
  isMutating?: (call: ToolCall) => boolean;
  /** 是否豁免风暴检测 */
  isStormExempt?: (call: ToolCall) => boolean;
}

/** 修复管道处理结果 */
export interface RepairResult {
  /** 修复后的工具调用列表 */
  calls: ToolCall[];
  /** 修复说明 */
  notes: string[];
  /** 修复统计 */
  stats: {
    flattenApplied: boolean;
    scavengedCount: number;
    truncationFixed: number;
    stormSuppressed: number;
  };
}
