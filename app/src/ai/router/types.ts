// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software and to permit persons to whom the Software is
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
 * 智能路由核心类型定义
 */

/** 四级分类：任务复杂度等级 */
export type RouterTier = 'simple' | 'medium' | 'complex' | 'reasoning';

/** 全部 tier 列表 */
export const ALL_ROUTER_TIERS: RouterTier[] = [
  'simple',
  'medium',
  'complex',
  'reasoning',
];

/** 单个 tier 的模型映射配置 */
export interface TierModelConfig {
  /** 模型 ID */
  model: string;
  /** 可选：供应商提示（如 'deepseek'、'ollama'），不指定则由 ProviderRegistry 根据模型前缀自动匹配 */
  providerHint?: string;
}

/** LLM Judge 云端回退配置 */
export interface JudgeCloudConfig {
  provider: string;
  model: string;
  timeoutMs: number;
}

/** SmartRouter 配置（存储于 config.json models.router） */
export interface RouterConfig {
  /** 总开关：前端可关闭，关闭后走 ModelRouter 静态路由 */
  enabled: boolean;
  /** LLM Judge 云端回退配置（可选：LocalAgent 可用时以本地模型优先） */
  judge?: JudgeCloudConfig;
  /** 四级的模型映射 */
  tiers: Partial<Record<RouterTier, TierModelConfig>>;
  /** 默认 tier（Judge 不可用时的兜底） */
  defaultTier: RouterTier;
  /** 会话黏性：同一 session 是否复用上次的 tier */
  sessionSticky?: boolean;
  /** 多级回退链：当主 provider 不可用时的备选供应商列表 */
  fallback?: RouterModelRef[];
  /** 零用量重试：检测到空响应时自动重试 */
  zeroUsageRetry?: {
    enabled: boolean;
    maxAttempts: number;
  };
  /** 瞬态错误重试：网络抖动/限流时的自动重试 */
  transientRetry?: {
    enabled: boolean;
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  /** 路由统计：记录 tier 维度成本 */
  stats?: {
    enabled: boolean;
  };
}

/** 供应商模型引用（用于 fallback 链） */
export interface RouterModelRef {
  provider: string;
  model: string;
}

/** SmartRouter 决策结果 */
export interface RouteDecision {
  /** 决策目标 Provider ID */
  provider: string;
  /** 决策模型 ID */
  model: string;
  /** 决策 tier */
  tier: RouterTier;
  /** 决策理由 */
  reason: string;
  /** 是否来自快速通道（SimpleQA/规则引擎跳过） */
  fastPath?: boolean;
}

/** 会话路由记录（持久化到 SQLite） */
export interface SessionRouteRecord {
  sessionId: string;
  tier: RouterTier;
  provider: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  hitCount: number;
}

/** Judge 分类结果 */
export interface JudgeResult {
  tier: RouterTier;
  confidence: number;
  reason: string;
  source: 'local' | 'cloud' | 'default';
}
